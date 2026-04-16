import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { computeStructuralDiff } from '../analysis/diff';
import { buildGraphData } from '../graph/builder';
import { loadGraph } from '../graph/loader';
import type { ImportEdge } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';
import { writeOutput } from '../shared/write-output';

interface DiffCommandOptions {
    repoDir: string;
    base?: string;
    files?: string[];
    graph: string;
    out: string;
}

export async function executeDiff(opts: DiffCommandOptions): Promise<void> {
    const t0 = performance.now();
    const repoDir = resolve(opts.repoDir);

    // Resolve changed files
    let changedFiles: string[];
    if (opts.base) {
        try {
            const output = execSync(`git diff --name-only ${opts.base}`, { cwd: repoDir, encoding: 'utf-8' });
            changedFiles = output.trim().split('\n').filter(Boolean);
        } catch (err) {
            log.error('failed to run git diff', { base: opts.base, error: String(err) });
            process.exit(1);
        }
    } else {
        changedFiles = opts.files!;
    }

    process.stderr.write(`[1/4] ${changedFiles.length} changed files\n`);

    // Load old graph
    const graphPath = resolve(opts.graph);
    if (!existsSync(graphPath)) {
        log.error('graph file not found', { path: graphPath });
        process.exit(1);
    }
    const oldGraph = loadGraph(graphPath);
    process.stderr.write(`[2/4] Loaded previous graph (${oldGraph.nodes.length} nodes)\n`);

    // Re-parse changed files
    const absFiles = discoverFiles(repoDir, changedFiles);
    const rawGraph = await parseBatch(absFiles, repoDir);

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
    for (const f of absFiles) {
        try {
            fileHashes.set(relative(repoDir, f), computeFileHash(f));
        } catch {}
    }

    const newGraphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes, symbolTable, importMap);
    process.stderr.write(`[3/4] Re-parsed ${absFiles.length} files (${newGraphData.nodes.length} nodes)\n`);

    // Compute diff
    const relChangedFiles = changedFiles.map((f) => (f.startsWith('/') ? relative(repoDir, f) : f));
    const result = computeStructuralDiff(oldGraph, newGraphData.nodes, newGraphData.edges, relChangedFiles);
    process.stderr.write(
        `[4/4] Diff: +${result.summary.added} -${result.summary.removed} ~${result.summary.modified} nodes (${Math.round(performance.now() - t0)}ms)\n`,
    );

    writeOutput(opts.out, JSON.stringify(result, null, 2));
}
