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
                process.stderr.write(`Error: Failed to read --graph file: ${opts.graph}\n`);
                process.exit(1);
            }
            const validated = GraphInputSchema.safeParse(raw);
            if (!validated.success) {
                process.stderr.write(`Error: Invalid graph JSON: ${validated.error.message}\n`);
                process.exit(1);
            }
            const changedSet = new Set(opts.files);
            const sameBranch = detectSameBranch(validated.data.nodes, parseResult.nodes, changedSet);

            log.info('context: baseline graph loaded', {
                graphNodes: validated.data.nodes.length,
                graphEdges: validated.data.edges.length,
                sameBranch,
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

/**
 * Detect if --graph was built from the same commit as the current repo.
 * Compares file_hash values for changed files between the graph and the fresh parse.
 * When hashes match, the graph can't serve as a baseline for diff — it IS the new state.
 */
function detectSameBranch(
    graphNodes: Array<{ file_path: string; file_hash: string }>,
    parseNodes: Array<{ file_path: string; file_hash: string }>,
    changedFiles: Set<string>,
): boolean {
    const graphHashes = new Map<string, string>();
    for (const n of graphNodes) {
        if (changedFiles.has(n.file_path) && n.file_hash && !graphHashes.has(n.file_path)) {
            graphHashes.set(n.file_path, n.file_hash);
        }
    }

    // No overlap means graph has no nodes for changed files — not same-branch scenario
    if (graphHashes.size === 0) {
        log.debug('detectSameBranch: no graph hashes for changed files');
        return false;
    }

    const parseHashes = new Map<string, string>();
    for (const n of parseNodes) {
        if (n.file_hash && !parseHashes.has(n.file_path)) {
            parseHashes.set(n.file_path, n.file_hash);
        }
    }

    // If any overlapping file has different hash → different branch
    for (const [file, hash] of graphHashes) {
        const parseHash = parseHashes.get(file);
        if (parseHash && parseHash !== hash) {
            log.debug('detectSameBranch: hash mismatch → different branch', {
                file,
                graphHash: hash.substring(0, 8),
                parseHash: parseHash.substring(0, 8),
            });
            return false;
        }
    }

    log.debug('detectSameBranch: all hashes match → same branch', {
        filesCompared: graphHashes.size,
    });
    return true;
}
