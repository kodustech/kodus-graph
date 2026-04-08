import { execSync } from 'child_process';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildContextV2 } from '../analysis/context-builder';
import { formatPrompt } from '../analysis/prompt-formatter';
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
    format: 'json' | 'prompt';
    skipTests?: boolean;
}

export async function executeContext(opts: ContextOptions): Promise<void> {
    const repoDir = resolve(opts.repoDir);

    log.info('context: starting', {
        files: opts.files,
        repoDir,
        graph: opts.graph ?? null,
        format: opts.format,
        minConfidence: opts.minConfidence,
        maxDepth: opts.maxDepth,
    });

    // Parse changed files using secure temp
    const tmp = createSecureTempFile('ctx');
    try {
        await executeParse({
            repoDir,
            files: opts.files,
            all: false,
            out: tmp.filePath,
            skipTests: opts.skipTests,
        });
        const parseResult = JSON.parse(readFileSync(tmp.filePath, 'utf-8'));

        log.info('context: parse done', {
            nodes: parseResult.nodes?.length ?? 0,
            edges: parseResult.edges?.length ?? 0,
        });

        // Load and merge with main graph if provided
        let mergedGraph: GraphData;
        let oldGraph: GraphData | null = null;

        if (opts.graph) {
            let raw: unknown;
            try {
                raw = JSON.parse(readFileSync(opts.graph, 'utf-8'));
            } catch (_err) {
                log.error('failed to read --graph file', { path: opts.graph });
                process.exit(1);
            }
            const validated = GraphInputSchema.safeParse(raw);
            if (!validated.success) {
                log.error('invalid graph JSON', { error: validated.error.message });
                process.exit(1);
            }
            const changedSet = new Set(opts.files);

            // Detect same-branch via commit sha comparison
            const graphSha = ((raw as Record<string, unknown>)?.sha as string) || '';
            let headSha = '';
            try {
                headSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
            } catch {
                log.debug('could not resolve HEAD sha');
            }
            const sameBranch = graphSha !== '' && graphSha === headSha;

            log.info('context: baseline graph loaded', {
                graphNodes: validated.data.nodes.length,
                graphEdges: validated.data.edges.length,
                sameBranch,
                graphSha: graphSha ? graphSha.substring(0, 8) : 'none',
                headSha: headSha ? headSha.substring(0, 8) : 'none',
            });

            if (sameBranch) {
                // --graph was built from the same commit (e.g. kodus-ai's parse --all on PR branch).
                // Exclude changed files from oldGraph so diff detects their functions as "added"
                // instead of falsely marking everything "unchanged".
                oldGraph = {
                    nodes: validated.data.nodes.filter((n: { file_path: string }) => !changedSet.has(n.file_path)),
                    edges: validated.data.edges.filter((e: { file_path: string }) => !changedSet.has(e.file_path)),
                };
                log.debug('Same-branch detected: excluding changed files from baseline', {
                    changedFiles: opts.files.length,
                });
            } else {
                oldGraph = { nodes: validated.data.nodes, edges: validated.data.edges };
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

        // Build V2 context
        const output = buildContextV2({
            mergedGraph,
            oldGraph,
            changedFiles: opts.files,
            minConfidence: opts.minConfidence,
            maxDepth: opts.maxDepth,
            skipTests: opts.skipTests,
        });

        log.info('context: analysis done', {
            changedFunctions: output.analysis.changed_functions.length,
            diff: output.analysis.structural_diff.summary,
            blastRadius: output.analysis.blast_radius.total_functions,
            risk: `${output.analysis.risk.level} (${output.analysis.risk.score})`,
            testGaps: output.analysis.test_gaps.length,
            affectedFlows: output.analysis.affected_flows.length,
            duration_ms: output.analysis.metadata.duration_ms,
        });

        if (opts.format === 'prompt') {
            writeFileSync(opts.out, formatPrompt(output));
        } else {
            writeFileSync(opts.out, JSON.stringify(output, null, 2));
        }
    } finally {
        try {
            rmSync(tmp.dir, { recursive: true, force: true });
        } catch (err) {
            log.debug('Failed to clean up temp dir', { dir: tmp.dir, error: String(err) });
        }
    }
}
