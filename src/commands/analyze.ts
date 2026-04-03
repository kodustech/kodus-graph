import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { computeBlastRadius } from '../analysis/blast-radius';
import { computeRiskScore } from '../analysis/risk-score';
import { findTestGaps } from '../analysis/test-gaps';
import { mergeGraphs } from '../graph/merger';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { buildGraphData } from '../graph/builder';
import type { AnalysisOutput, MainGraphInput } from '../graph/types';
import { GraphInputSchema } from '../shared/schemas';

interface AnalyzeOptions {
  repoDir: string;
  files: string[];
  graph?: string;
  out: string;
}

export async function executeAnalyze(opts: AnalyzeOptions): Promise<void> {
  const repoDir = resolve(opts.repoDir);

  // Load main graph if provided
  let mainGraph: MainGraphInput | null = null;
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
    mainGraph = {
      repo_id: '',
      sha: '',
      nodes: validated.data.nodes,
      edges: validated.data.edges,
    };
  }

  // Parse changed files locally
  const localFiles = discoverFiles(repoDir, opts.files);
  const rawGraph = await parseBatch(localFiles, repoDir);
  const localGraphData = buildGraphData(rawGraph, [], [], repoDir, new Map());

  // Merge with main graph (or use local only)
  const mergedGraph = mainGraph
    ? mergeGraphs(mainGraph, localGraphData, opts.files)
    : localGraphData;

  // Analyze
  const blastRadius = computeBlastRadius(mergedGraph, opts.files);
  const riskScore = computeRiskScore(mergedGraph, opts.files, blastRadius);
  const testGaps = findTestGaps(mergedGraph, opts.files);

  const output: AnalysisOutput = {
    blast_radius: blastRadius,
    risk_score: riskScore,
    test_gaps: testGaps,
  };

  writeFileSync(opts.out, JSON.stringify(output, null, 2));
}
