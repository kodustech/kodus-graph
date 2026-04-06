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
  if (!cleaned || cleaned === base) return null;
  return cleaned;
}

export function deriveEdges(graph: RawGraph, importEdges: ImportEdge[]): DerivedEdges {
  // INHERITS: class extends another class
  const inherits = graph.classes
    .filter((c) => c.extends)
    .map((c) => ({ source: c.qualified, target: c.extends, file: c.file }));

  // IMPLEMENTS: class implements interface
  const implements_ = graph.classes
    .filter((c) => c.implements)
    .map((c) => ({ source: c.qualified, target: c.implements, file: c.file }));

  // TESTED_BY: two heuristics, deduplicated
  const testFiles = new Set(graph.tests.map((t) => t.file));
  const testedBySet = new Set<string>();
  const testedBy: DerivedEdge[] = [];

  const addTestedBy = (source: string, target: string) => {
    const key = `${source}|${target}`;
    if (testedBySet.has(key)) return;
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
  for (const f of graph.functions) allSourceFiles.add(f.file);
  for (const c of graph.classes) allSourceFiles.add(c.file);
  for (const i of graph.interfaces) allSourceFiles.add(i.file);
  for (const e of graph.enums) allSourceFiles.add(e.file);
  for (const tf of testFiles) allSourceFiles.delete(tf);

  const sourceByBase = new Map<string, string[]>();
  for (const file of allSourceFiles) {
    const base = basename(file, extname(file));
    const list = sourceByBase.get(base);
    if (list) list.push(file);
    else sourceByBase.set(base, [file]);
  }

  for (const testFile of testFiles) {
    const stem = extractTestStem(testFile);
    if (!stem) continue;
    const matches = sourceByBase.get(stem);
    if (!matches) continue;
    for (const sourceFile of matches) {
      addTestedBy(sourceFile, testFile);
    }
  }

  // CONTAINS: file contains function/class
  const contains: DerivedEdge[] = [];
  for (const f of graph.functions) contains.push({ source: f.file, target: f.qualified });
  for (const c of graph.classes) contains.push({ source: c.file, target: c.qualified });

  return { inherits, implements: implements_, testedBy, contains };
}
