import { basename, extname } from 'path';
import { languageOfFile } from '../languages/language-of-file';
import type { ImportEdge, RawCallEdge, RawGraph } from './types';

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
    usesType: DerivedEdge[];
}

/**
 * Identifiers appearing in a signature, as candidate type references.
 *
 * Deliberately not a per-language type parser. Signatures come in two shapes —
 * `(o: Order)` in TS/Kotlin/Rust/Python, `(Order o)` in Java/C#/PHP — plus
 * pointers, generics, and defaults, and writing 14 parsers to tell a type from a
 * parameter name would be a lot of surface for a question already answered
 * downstream: `resolveTypeName` only resolves names that this repo actually
 * declares and this file actually imported. `string`, `int`, `Promise` and a
 * parameter named `o` all fail to resolve and disappear.
 *
 * So: pull every identifier, let the resolver be the filter, and require the
 * resolution to land on a type (see `deriveEdges`).
 */
function typeCandidates(signature: string): string[] {
    if (!signature) {
        return [];
    }
    const out = new Set<string>();
    for (const m of signature.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
        out.add(m[0]);
    }
    return [...out];
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

/** Count leading path segments two files share. `a/b/c.ts` vs `a/b/d.ts` → 2. */
function sharedPrefixDepth(a: string, b: string): number {
    const as = a.split('/');
    const bs = b.split('/');
    let n = 0;
    while (n < as.length - 1 && n < bs.length - 1 && as[n] === bs[n]) {
        n++;
    }
    return n;
}

/**
 * Pick the one source file a test file most plausibly covers, by path proximity.
 *
 * Filename matching is keyed on the bare basename, so a stem can hit several
 * files at once — `tests/user.test.ts` matches both `src/user.ts` and
 * `src/admin/user.ts`. Claiming all of them is how a test for `createUser` came
 * to mark `deleteAllUsers` covered.
 *
 * Returns null on a tie: if two candidates sit equally close, nothing here can
 * say which one is meant, and inventing coverage is worse than reporting a gap.
 */
function nearestByPath(testFile: string, candidates: readonly string[]): string | null {
    if (candidates.length === 1) {
        return candidates[0];
    }
    let best: string | null = null;
    let bestDepth = -1;
    let tied = false;
    for (const c of candidates) {
        const depth = sharedPrefixDepth(testFile, c);
        if (depth > bestDepth) {
            bestDepth = depth;
            best = c;
            tied = false;
        } else if (depth === bestDepth) {
            tied = true;
        }
    }
    return tied ? null : best;
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
    _importEdges: ImportEdge[],
    symbolTable?: { lookupGlobal(name: string): string[] },
    importMap?: { lookup(file: string, name: string): string | null },
    /**
     * Resolved call edges. TESTED_BY is derived from these: a test that calls a
     * function is the only direct evidence that the function is exercised.
     */
    callEdges: readonly RawCallEdge[] = [],
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

    // TESTED_BY — "a test exercises this", in two tiers.
    //
    // Primary evidence is a resolved CALL from a test file to a symbol: the test
    // demonstrably runs that function. It is emitted per SYMBOL, because that is
    // the granularity the question actually has. Whole-file coverage claims are
    // where this went wrong before: a test importing one constant marked every
    // function in the file tested, and `test_gaps` — 30% of the risk score —
    // silently reported "0/3 untested" for three untested functions.
    //
    // The old import-based heuristic is gone. It fired on `import { CURRENCY }`
    // just as readily as on a call, and it has no regime of its own: where
    // imports resolve, calls resolve too and carry strictly more information;
    // where they don't, it never fires at all.
    //
    // File-name matching survives as a fallback, but only for languages whose
    // test calls we could not resolve at all (rust, today). Where call
    // resolution works, a filename coincidence adds nothing but false coverage.
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

    // Tier 1: resolved calls out of test files → symbol-level TESTED_BY.
    const langsWithResolvedTestCalls = new Set<string>();
    for (const ce of callEdges) {
        const callerFile = String(ce.source).split('::')[0];
        if (!testFiles.has(callerFile)) {
            continue;
        }
        const target = String(ce.target);
        // Only in-repo symbols; `foo.ts::bar`, never a bare file or a package.
        if (!target.includes('::')) {
            continue;
        }
        addTestedBy(target, callerFile);
        const lang = languageOfFile(callerFile);
        if (lang) {
            langsWithResolvedTestCalls.add(lang);
        }
    }

    // Tier 2: file-name matching, for languages tier 1 could not speak for.
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
        const lang = languageOfFile(testFile);
        // Tier 1 already spoke for this language; a filename coincidence can only
        // add false coverage on top of real call evidence.
        if (lang && langsWithResolvedTestCalls.has(lang)) {
            continue;
        }
        const stem = extractTestStem(testFile);
        if (!stem) {
            continue;
        }
        const matches = sourceByBase.get(stem);
        if (!matches) {
            continue;
        }
        // Match on the nearest path, not on the bare name. `sourceByBase` is
        // keyed by basename, so `tests/user.test.ts` used to claim EVERY `user.*`
        // in the repo — including `src/admin/user.ts`, whose `deleteAllUsers` the
        // test has never heard of. Prefer the closest shared directory prefix and
        // take exactly one match; if several tie, the evidence is too weak to
        // name a file and we report the gap instead.
        const best = nearestByPath(testFile, matches);
        if (best) {
            addTestedBy(best, testFile);
        }
    }

    // USES_TYPE: function references a repo type in its signature.
    //
    // Types are a dependency the call graph cannot see. `checkout(o: Order)`
    // never calls anything in `types.ts`, so with CALLS and IMPORTS alone,
    // changing `Order` — renaming a field, adding a required one — reported a
    // blast radius of zero while two functions broke. IMPORTS edges exist but are
    // file-to-file, and the blast radius seeds from symbols, so they never meet.
    //
    // Only types this repo declares produce an edge. `resolveTypeName` goes
    // through the import map first, so `string`, `int` and `Promise` resolve to
    // nothing and vanish; requiring the resolution to be a Class/Interface/Enum
    // drops parameter names that happen to collide with a function's.
    const typeKinds = new Set<string>();
    for (const c of graph.classes) {
        typeKinds.add(c.qualified);
    }
    for (const i of graph.interfaces) {
        typeKinds.add(i.qualified);
    }
    for (const e of graph.enums) {
        typeKinds.add(e.qualified);
    }

    const usesType: DerivedEdge[] = [];
    const usesTypeSeen = new Set<string>();
    for (const f of graph.functions) {
        for (const candidate of typeCandidates(`${f.params} ${f.returnType}`)) {
            const resolved = resolveTypeName(candidate, f.file, graph, symbolTable, importMap);
            if (!resolved || !typeKinds.has(resolved)) {
                continue;
            }
            if (resolved === f.qualified) {
                continue;
            }
            const key = `${f.qualified}|${resolved}`;
            if (usesTypeSeen.has(key)) {
                continue;
            }
            usesTypeSeen.add(key);
            usesType.push({ source: f.qualified, target: resolved, file: f.file });
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

    return { inherits, implements: implements_, testedBy, contains, usesType };
}
