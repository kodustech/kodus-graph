import { resolve } from 'path';
import { readFileSync, writeFileSync, rmSync } from 'fs';
import { executeParse } from './parse';
import { mergeGraphs } from '../graph/merger';
import { buildReviewContext } from '../analysis/review-context';
import type { MainGraphInput, ContextOutput } from '../graph/types';
import { log } from '../shared/logger';
import { createSecureTempFile } from '../shared/temp';

interface ContextOptions {
  repoDir: string;
  files: string[];
  graph?: string;
  out: string;
}

export async function executeContext(opts: ContextOptions): Promise<void> {
  const repoDir = resolve(opts.repoDir);

  // Parse changed files using secure temp
  const tmp = createSecureTempFile('ctx');
  try {
    await executeParse({
      repoDir,
      files: opts.files,
      all: false,
      out: tmp.filePath,
    });
    const parseResult = JSON.parse(readFileSync(tmp.filePath, 'utf-8'));

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
  } finally {
    try { rmSync(tmp.dir, { recursive: true, force: true }); } catch (err) {
      log.debug('Failed to clean up temp dir', { dir: tmp.dir, error: String(err) });
    }
  }
}
