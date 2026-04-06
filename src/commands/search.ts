import { writeFileSync } from 'fs';
import { findCallees, findCallers, searchNodes } from '../analysis/search';
import { loadGraph } from '../graph/loader';
import type { GraphNode } from '../graph/types';

interface SearchCommandOptions {
  graph: string;
  query?: string;
  kind?: string;
  file?: string;
  callersOf?: string;
  calleesOf?: string;
  limit: number;
  out?: string;
}

export function executeSearch(opts: SearchCommandOptions): void {
  const graph = loadGraph(opts.graph);

  let results: GraphNode[];
  let queryInfo: Record<string, string | null>;

  if (opts.callersOf) {
    results = findCallers(graph, opts.callersOf);
    queryInfo = { callers_of: opts.callersOf, kind: null, file: null };
  } else if (opts.calleesOf) {
    results = findCallees(graph, opts.calleesOf);
    queryInfo = { callees_of: opts.calleesOf, kind: null, file: null };
  } else {
    results = searchNodes(graph, { query: opts.query, kind: opts.kind, file: opts.file, limit: opts.limit });
    queryInfo = { pattern: opts.query || null, kind: opts.kind || null, file: opts.file || null };
  }

  const output = JSON.stringify({ results, total: results.length, query: queryInfo }, null, 2);

  if (opts.out) {
    writeFileSync(opts.out, output);
  } else {
    process.stdout.write(`${output}\n`);
  }
}
