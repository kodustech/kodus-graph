import { resolve } from 'path';
import { readFileSync, writeFileSync, rmSync } from 'fs';
import { executeParse } from './parse';
import { mergeGraphs } from '../graph/merger';
import { buildReviewContext } from '../analysis/review-context';
import type { MainGraphInput, ContextOutput } from '../graph/types';

interface ContextOptions {
  repoDir: string;
  files: string[];
  graph?: string;
  out: string;
}

export async function executeContext(opts: ContextOptions): Promise<void> {
  const repoDir = resolve(opts.repoDir);

  // Parse changed files
  const parseTmpPath = `/tmp/kodus-graph-context-parse-${Date.now()}.json`;
  await executeParse({
    repoDir,
    files: opts.files,
    all: false,
    out: parseTmpPath,
  });
  const parseResult = JSON.parse(readFileSync(parseTmpPath, 'utf-8'));

  // Load and merge with main graph if provided
  let mergedGraph;
  if (opts.graph) {
    const raw = JSON.parse(readFileSync(opts.graph, 'utf-8'));
    const mainGraph: MainGraphInput = {
      repo_id: '',
      sha: '',
      nodes: raw.nodes,
      edges: raw.edges,
    };
    mergedGraph = mergeGraphs(mainGraph, parseResult, opts.files);
  } else {
    mergedGraph = { nodes: parseResult.nodes, edges: parseResult.edges };
  }

  // Build review context
  const contextOutput: ContextOutput = buildReviewContext(mergedGraph, opts.files);

  writeFileSync(opts.out, JSON.stringify(contextOutput, null, 2));

  // Cleanup temp file
  try { rmSync(parseTmpPath, { force: true }); } catch {}
}
