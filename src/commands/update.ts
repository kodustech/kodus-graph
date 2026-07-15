import { existsSync, mkdirSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { buildGraphData } from '../graph/builder';
import { writeGraphJSON } from '../graph/json-writer';
import { loadGraph } from '../graph/loader';
import type { GraphEdge, GraphNode, ImportEdge, ParseOutput, TierDistribution } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveCallsForGraph } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { buildReExportMap } from '../resolver/re-export-resolver';
import { createSymbolTable, seedSymbolTableFromBaseline } from '../resolver/symbol-table';
import { SCHEMA_VERSION } from '../shared/constants';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';

const DEFAULT_GRAPH_PATH = '.kodus-graph/graph.json';

interface UpdateCommandOptions {
    repoDir: string;
    graph?: string;
    out?: string;
}

export async function executeUpdate(opts: UpdateCommandOptions): Promise<void> {
    const t0 = performance.now();
    const repoDir = resolve(opts.repoDir);
    const graphPath = resolve(repoDir, opts.graph || DEFAULT_GRAPH_PATH);
    const rawOut = opts.out ?? opts.graph ?? DEFAULT_GRAPH_PATH;
    const outPath = rawOut === '-' ? '-' : resolve(repoDir, rawOut);

    if (!existsSync(graphPath)) {
        log.error('graph file not found — run "kodus-graph parse" first', { path: graphPath });
        process.exit(1);
    }

    const oldGraph = loadGraph(graphPath);
    process.stderr.write(`[1/5] Loaded previous graph (${oldGraph.nodes.length} nodes)\n`);

    // Build file hash index from old graph
    const oldHashes = new Map<string, string>();
    for (const node of oldGraph.nodes) {
        if (node.file_hash && !oldHashes.has(node.file_path)) {
            oldHashes.set(node.file_path, node.file_hash);
        }
    }

    // Discover current files
    const allFiles = discoverFiles(repoDir);
    const allRel = allFiles.map((f) => relative(repoDir, f));
    const currentFiles = new Set(allRel);
    const oldFiles = new Set(oldHashes.keys());

    // Classify files
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const unchanged: string[] = [];

    for (const file of currentFiles) {
        const absPath = resolve(repoDir, file);
        if (!oldHashes.has(file)) {
            added.push(file);
        } else {
            const currentHash = computeFileHash(absPath);
            if (currentHash !== oldHashes.get(file)) {
                modified.push(file);
            } else {
                unchanged.push(file);
            }
        }
    }

    for (const file of oldFiles) {
        if (!currentFiles.has(file)) {
            deleted.push(file);
        }
    }

    const toReparse = [...added, ...modified];
    process.stderr.write(
        `[2/5] Files: ${added.length} added, ${modified.length} modified, ${deleted.length} deleted, ${unchanged.length} unchanged\n`,
    );

    if (toReparse.length === 0 && deleted.length === 0) {
        process.stderr.write('[3/5] No changes detected, graph is up to date\n');
        const output: ParseOutput = {
            metadata: {
                ...oldGraph.metadata,
                duration_ms: Math.round(performance.now() - t0),
                files_unchanged: unchanged.length,
                incremental: true,
                schema_version: SCHEMA_VERSION,
            },
            nodes: oldGraph.nodes,
            edges: oldGraph.edges,
        };
        ensureDir(outPath);
        writeGraphJSON(outPath, output.metadata, output.nodes, output.edges);
        return;
    }

    // Re-parse changed files
    const absToReparse = toReparse.map((f) => resolve(repoDir, f));
    const rawGraph = await parseBatch(absToReparse, repoDir);
    process.stderr.write(`[3/5] Re-parsed ${toReparse.length} files\n`);

    // Resolve imports and calls for new files
    const tsconfigAliases = loadTsconfigAliases(repoDir);
    const symbolTable = createSymbolTable();
    const importMap = createImportMap();
    const importEdges: ImportEdge[] = [];

    for (const f of rawGraph.functions) {
        symbolTable.add(f.file, f.name, f.qualified);
    }
    for (const c of rawGraph.classes) {
        symbolTable.add(c.file, c.name, c.qualified);
    }
    for (const i of rawGraph.interfaces) {
        symbolTable.add(i.file, i.name, i.qualified);
    }

    // The slice is a handful of files; the resolver's ambiguity checks are
    // population statistics over the whole repo. Seed the rest from the previous
    // graph — already loaded above — or every name in the slice looks unique and
    // genuinely ambiguous calls get promoted to 0.60 and shipped.
    const sliceFiles = new Set<string>(toReparse);
    const seeded = seedSymbolTableFromBaseline(symbolTable, oldGraph.nodes, sliceFiles);
    log.debug('update: seeded symbol table with baseline nodes', {
        seeded,
        baselineTotal: oldGraph.nodes.length,
        sliceFiles: sliceFiles.size,
    });

    // Follow re-exports so barrel imports resolve to the defining file, matching
    // `parse`. Without this an `update` graph and a `parse` graph of the same
    // repo disagree on every call made through a barrel.
    const barrelMap = buildReExportMap(rawGraph.reExports, repoDir, tsconfigAliases);

    for (const imp of rawGraph.imports) {
        const langKey = imp.lang;
        const resolved = resolveImport(resolve(repoDir, imp.file), imp.module, langKey, repoDir, tsconfigAliases);
        const resolvedRel = resolved ? relative(repoDir, resolved) : null;
        importEdges.push({
            source: imp.file,
            target: resolvedRel || imp.module,
            resolved: !!resolvedRel,
            line: imp.line,
        });
        const target = resolvedRel || imp.module;
        for (const name of imp.names) {
            let finalTarget = target;
            if (resolvedRel) {
                const reExportedFiles = barrelMap.get(resolvedRel);
                if (reExportedFiles) {
                    for (const reFile of reExportedFiles) {
                        if (symbolTable.lookupExact(reFile, name)) {
                            finalTarget = reFile;
                            break;
                        }
                    }
                }
            }
            importMap.add(imp.file, name, finalTarget);
        }
    }

    const { callEdges, stats } = resolveCallsForGraph(rawGraph, symbolTable, importMap);

    const fileHashes = new Map<string, string>();
    for (const f of absToReparse) {
        try {
            fileHashes.set(relative(repoDir, f), computeFileHash(f));
        } catch {}
    }

    // Baseline files live outside the slice, so `rawGraph` holds none of their
    // symbols and the builder's external-target guard would drop every CALLS
    // edge the baseline seeding just made resolvable. Declare them known.
    const baselineFiles = new Set(oldGraph.nodes.map((n) => n.file_path));
    const newGraphData = buildGraphData(
        rawGraph,
        callEdges,
        importEdges,
        repoDir,
        fileHashes,
        symbolTable,
        importMap,
        baselineFiles,
    );
    process.stderr.write(`[4/5] Built new graph fragment (${newGraphData.nodes.length} nodes)\n`);

    // Merge: keep old nodes/edges NOT in changed/deleted files, add new ones
    const changedOrDeleted = new Set([...toReparse, ...deleted]);
    const mergedNodes: GraphNode[] = oldGraph.nodes.filter((n) => !changedOrDeleted.has(n.file_path));
    const mergedEdges: GraphEdge[] = oldGraph.edges.filter((e) => !changedOrDeleted.has(e.file_path));

    mergedNodes.push(...newGraphData.nodes);
    mergedEdges.push(...newGraphData.edges);

    process.stderr.write(`[5/5] Merged: ${mergedNodes.length} nodes, ${mergedEdges.length} edges\n`);

    // Merged tier_distribution: count tiers across all surviving CALLS edges
    // (old + new), not just the slice. `tier` is persisted on each edge
    // (added 2026-04-30), so this is exact for receiver/di/same/import/unique/
    // ambiguous. `noise` and `ambiguousNoise` are *drop* outcomes (no edge),
    // so they reflect only the slice's reparse — old surviving files
    // contribute nothing, since their noise counts weren't preserved.
    const tierDistribution = mergeTierDistribution(mergedEdges, stats);

    const output: ParseOutput = {
        metadata: {
            repo_dir: repoDir,
            files_parsed: toReparse.length,
            files_unchanged: unchanged.length,
            total_nodes: mergedNodes.length,
            total_edges: mergedEdges.length,
            duration_ms: Math.round(performance.now() - t0),
            parse_errors: rawGraph.parseErrors,
            extract_errors: rawGraph.extractErrors,
            incremental: true,
            schema_version: SCHEMA_VERSION,
            tier_distribution: tierDistribution,
        },
        nodes: mergedNodes,
        edges: mergedEdges,
    };

    ensureDir(outPath);
    // Stream node-by-node, as `parse` does. `JSON.stringify(output, null, 2)`
    // built the entire merged graph as one pretty-printed string — on a large
    // monorepo that is a multi-hundred-MB allocation, and Node/Bun throw
    // `Invalid string length` past ~512MB. The adaptive batch sizing in
    // parser/batch.ts carefully holds parse memory down, and this undid it at the
    // last step. `writeGraphJSON` keeps peak memory at one serialized node.
    writeGraphJSON(outPath, output.metadata, output.nodes, output.edges);
}

function ensureDir(filePath: string): void {
    if (filePath === '-') {
        return;
    }
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

interface SliceNoiseStats {
    noise: number;
    ambiguousNoise: number;
}

function mergeTierDistribution(mergedEdges: GraphEdge[], sliceStats: SliceNoiseStats): TierDistribution {
    const td: TierDistribution = {
        receiver: 0,
        di: 0,
        same: 0,
        import: 0,
        unique: 0,
        ambiguous: 0,
        noise: sliceStats.noise,
        ambiguousNoise: sliceStats.ambiguousNoise,
    };
    for (const e of mergedEdges) {
        if (e.kind !== 'CALLS' || !e.tier) {
            continue;
        }
        td[e.tier]++;
    }
    return td;
}
