import { resolve } from 'path';
import { readFileSync, writeFileSync, rmSync } from 'fs';
import { executeParse } from './parse';
import { mergeGraphs } from '../graph/merger';
import { buildReviewContext } from '../analysis/review-context';
import type { MainGraphInput, ContextOutput } from '../graph/types';
import { log } from '../shared/logger';
import { createSecureTempFile } from '../shared/temp';
import { GraphInputSchema } from '../shared/schemas';

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
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(opts.graph, 'utf-8'));
      } catch (err) {
        process.stderr.write(`Error: Failed to read --graph file: ${opts.graph}\n`);
        process.exit(1);
      }
      const validated = GraphInputSchema.safeParse(raw);
      if (!validated.success) {
        process.stderr.write(`Error: Invalid graph JSON: ${validated.error.message}\n`);
        process.exit(1);
      }
      const mainGraph: MainGraphInput = {
        repo_id: '',
        sha: '',
        nodes: validated.data.nodes,
        edges: validated.data.edges,
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
