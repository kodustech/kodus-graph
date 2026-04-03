import type { RawGraph, ImportEdge } from './types';

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

export function deriveEdges(graph: RawGraph, importEdges: ImportEdge[]): DerivedEdges {
  // INHERITS: class extends another class
  const inherits = graph.classes
    .filter(c => c.extends)
    .map(c => ({ source: c.qualified, target: c.extends, file: c.file }));

  // IMPLEMENTS: class implements interface
  const implements_ = graph.classes
    .filter(c => c.implements)
    .map(c => ({ source: c.qualified, target: c.implements, file: c.file }));

  // TESTED_BY: test files that import source files
  const testFiles = new Set(graph.tests.map(t => t.file));
  const testedBy = importEdges
    .filter(e => testFiles.has(e.source) && e.resolved)
    .map(e => ({ source: e.target, target: e.source }));

  // CONTAINS: file contains function/class
  const contains: DerivedEdge[] = [];
  for (const f of graph.functions) contains.push({ source: f.file, target: f.qualified });
  for (const c of graph.classes) contains.push({ source: c.file, target: c.qualified });

  return { inherits, implements: implements_, testedBy, contains };
}
