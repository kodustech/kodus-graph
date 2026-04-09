import { basename, extname } from 'path';
import type { ImportEdge, RawGraph } from './types';

interface DerivedEdge {
    source: string;
    target: string;
    file?: string;
}

export interface DerivedEdges {
    inherits: DerivedEdge[];
    implements: DerivedEdge[];
    testedBy: DerivedEdge[];
    contains: DerivedEdge[];
}

/**
 * Extract the "stem" from a test file name by stripping test-related
 * prefixes/suffixes. Returns null if no test pattern was found.
 */
export function extractTestStem(testFile: string): string | null {
    const base = basename(testFile, extname(testFile));
    const cleaned = base
        .replace(/_spec$/, '') // user_spec → user (Ruby/RSpec)
        .replace(/_test$/, '') // user_test → user (Python/Go)
        .replace(/^test_/, '') // test_user → user (Python)
        .replace(/\.test$/, '') // user.test → user (JS/TS)
        .replace(/\.spec$/, '') // user.spec → user (JS/TS)
        .replace(/-test$/, '') // user-test → user
        .replace(/-spec$/, '') // user-spec → user
        .replace(/^spec_/, '') // spec_user → user
        .replace(/Test$/, '') // UserTest → User (Java)
        .replace(/Spec$/, ''); // UserSpec → User (Scala)
    if (!cleaned || cleaned === base) {
        return null;
    }
    return cleaned;
}

/**
 * Resolve a bare type name (e.g. "User", "IAuthService") to its qualified name
 * using import map, same-file lookup, and global symbol table.
 * Returns null if the name cannot be resolved (external class/interface).
 */
function resolveTypeName(
    name: string,
    file: string,
    graph: RawGraph,
    symbolTable?: { lookupGlobal(name: string): string[] },
    importMap?: { lookup(file: string, name: string): string | null },
): string | null {
    // 1. Check import map — was it imported in this file?
    const importedFrom = importMap?.lookup(file, name);
    if (importedFrom) {
        // Look up the qualified name in the imported file
        const candidates = symbolTable?.lookupGlobal(name) ?? [];
        const match = candidates.find((q) => q.startsWith(`${importedFrom}::`));
        if (match) {
            return match;
        }
        // If importedFrom is not a local file (not in graph), it's an external package — skip
        const isLocal =
            graph.classes.some((c) => c.file === importedFrom) ||
            graph.interfaces.some((i) => i.file === importedFrom) ||
            graph.functions.some((f) => f.file === importedFrom);
        if (!isLocal) {
            return null;
        }
        // Fallback: construct qualified name from local import target
        return `${importedFrom}::${name}`;
    }

    // 2. Check same file — class or interface defined in same file
    const sameFileClass = graph.classes.find((other) => other.name === name && other.file === file);
    if (sameFileClass) {
        return sameFileClass.qualified;
    }
    const sameFileInterface = graph.interfaces.find((other) => other.name === name && other.file === file);
    if (sameFileInterface) {
        return sameFileInterface.qualified;
    }

    // 3. Check global symbol table — unique match only
    const globalCandidates = symbolTable?.lookupGlobal(name) ?? [];
    if (globalCandidates.length === 1) {
        return globalCandidates[0];
    }

    // 4. External class/interface (React.Component, Error, etc.) — unresolvable
    return null;
}

export function deriveEdges(
    graph: RawGraph,
    importEdges: ImportEdge[],
    symbolTable?: { lookupGlobal(name: string): string[] },
    importMap?: { lookup(file: string, name: string): string | null },
): DerivedEdges {
    // INHERITS: class extends another class — resolve to qualified names
    const inherits: DerivedEdge[] = [];
    for (const c of graph.classes) {
        if (!c.extends) {
            continue;
        }

        const resolved = resolveTypeName(c.extends, c.file, graph, symbolTable, importMap);
        if (resolved) {
            inherits.push({ source: c.qualified, target: resolved, file: c.file });
        }
        // Skip unresolvable external classes (React.Component, Error, etc.)
    }

    // IMPLEMENTS: class implements interface(s) — resolve to qualified names
    const implements_: DerivedEdge[] = [];
    for (const c of graph.classes) {
        for (const iface of c.implements) {
            const resolved = resolveTypeName(iface, c.file, graph, symbolTable, importMap);
            if (resolved) {
                implements_.push({ source: c.qualified, target: resolved, file: c.file });
            }
            // Skip unresolvable external interfaces
        }
    }

    // TESTED_BY: two heuristics, deduplicated
    const testFiles = new Set(graph.tests.map((t) => t.file));
    const testedBySet = new Set<string>();
    const testedBy: DerivedEdge[] = [];

    const addTestedBy = (source: string, target: string) => {
        const key = `${source}|${target}`;
        if (testedBySet.has(key)) {
            return;
        }
        testedBySet.add(key);
        testedBy.push({ source, target });
    };

    // Heuristic 1: Resolved imports from test files (high signal)
    for (const e of importEdges) {
        if (testFiles.has(e.source) && e.resolved) {
            addTestedBy(e.target, e.source);
        }
    }

    // Heuristic 2: File-name matching (catches Ruby, Python, and any
    // language where imports don't resolve)
    const allSourceFiles = new Set<string>();
    for (const f of graph.functions) {
        allSourceFiles.add(f.file);
    }
    for (const c of graph.classes) {
        allSourceFiles.add(c.file);
    }
    for (const i of graph.interfaces) {
        allSourceFiles.add(i.file);
    }
    for (const e of graph.enums) {
        allSourceFiles.add(e.file);
    }
    for (const tf of testFiles) {
        allSourceFiles.delete(tf);
    }

    const sourceByBase = new Map<string, string[]>();
    for (const file of allSourceFiles) {
        const base = basename(file, extname(file));
        const list = sourceByBase.get(base);
        if (list) {
            list.push(file);
        } else {
            sourceByBase.set(base, [file]);
        }
    }

    for (const testFile of testFiles) {
        const stem = extractTestStem(testFile);
        if (!stem) {
            continue;
        }
        const matches = sourceByBase.get(stem);
        if (!matches) {
            continue;
        }
        for (const sourceFile of matches) {
            addTestedBy(sourceFile, testFile);
        }
    }

    // CONTAINS: file contains function/class
    const contains: DerivedEdge[] = [];
    for (const f of graph.functions) {
        contains.push({ source: f.file, target: f.qualified });
    }
    for (const c of graph.classes) {
        contains.push({ source: c.file, target: c.qualified });
    }

    return { inherits, implements: implements_, testedBy, contains };
}
