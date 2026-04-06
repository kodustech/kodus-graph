import { readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildContextV2 } from '../analysis/context-builder';
import { mergeGraphs } from '../graph/merger';
import type { GraphData, MainGraphInput } from '../graph/types';
import { log } from '../shared/logger';
import { GraphInputSchema } from '../shared/schemas';
import { createSecureTempFile } from '../shared/temp';
import { executeParse } from './parse';

interface ContextOptions {
  repoDir: string;
  files: string[];
  graph?: string;
  out: string;
  minConfidence: number;
  maxDepth: number;
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
    let mergedGraph: GraphData;
    let oldGraph: GraphData | null = null;

    if (opts.graph) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(opts.graph, 'utf-8'));
      } catch (_err) {
        process.stderr.write(`Error: Failed to read --graph file: ${opts.graph}\n`);
        process.exit(1);
      }
      const validated = GraphInputSchema.safeParse(raw);
      if (!validated.success) {
        process.stderr.write(`Error: Invalid graph JSON: ${validated.error.message}\n`);
        process.exit(1);
      }
      oldGraph = { nodes: validated.data.nodes, edges: validated.data.edges };
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

    // Build V2 context
    const output = buildContextV2({
      mergedGraph,
      oldGraph,
      changedFiles: opts.files,
      minConfidence: opts.minConfidence,
      maxDepth: opts.maxDepth,
    });

    writeFileSync(opts.out, JSON.stringify(output, null, 2));
  } finally {
    try {
      rmSync(tmp.dir, { recursive: true, force: true });
    } catch (err) {
      log.debug('Failed to clean up temp dir', { dir: tmp.dir, error: String(err) });
    }
  }
}
