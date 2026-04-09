import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { buildGraphData } from '../graph/builder';
import { loadGraph } from '../graph/loader';
import type { GraphEdge, GraphNode, ImportEdge, ParseOutput } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
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
    const outPath = resolve(repoDir, opts.out || opts.graph || DEFAULT_GRAPH_PATH);

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
            },
            nodes: oldGraph.nodes,
            edges: oldGraph.edges,
        };
        ensureDir(outPath);
        writeFileSync(outPath, JSON.stringify(output, null, 2));
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
            importMap.add(imp.file, name, target);
        }
    }

    const { callEdges } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);

    const fileHashes = new Map<string, string>();
    for (const f of absToReparse) {
        try {
            fileHashes.set(relative(repoDir, f), computeFileHash(f));
        } catch {}
    }

    const newGraphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes, symbolTable, importMap);
    process.stderr.write(`[4/5] Built new graph fragment (${newGraphData.nodes.length} nodes)\n`);

    // Merge: keep old nodes/edges NOT in changed/deleted files, add new ones
    const changedOrDeleted = new Set([...toReparse, ...deleted]);
    const mergedNodes: GraphNode[] = oldGraph.nodes.filter((n) => !changedOrDeleted.has(n.file_path));
    const mergedEdges: GraphEdge[] = oldGraph.edges.filter((e) => !changedOrDeleted.has(e.file_path));

    mergedNodes.push(...newGraphData.nodes);
    mergedEdges.push(...newGraphData.edges);

    process.stderr.write(`[5/5] Merged: ${mergedNodes.length} nodes, ${mergedEdges.length} edges\n`);

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
        },
        nodes: mergedNodes,
        edges: mergedEdges,
    };

    ensureDir(outPath);
    writeFileSync(outPath, JSON.stringify(output, null, 2));
}

function ensureDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
