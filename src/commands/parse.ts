import { relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { buildGraphData } from '../graph/builder';
import { writeGraphJSON } from '../graph/json-writer';
import type { GraphNode, ImportEdge, TierDistribution } from '../graph/types';
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

export interface ParseOptions {
    repoDir: string;
    files?: string[];
    all: boolean;
    out: string;
    include?: string[];
    exclude?: string[];
    skipTests?: boolean;
    maxMemoryMB?: number;
    /** Refuse to walk more than this many files (full-tree scan only). */
    maxFiles?: number;
    /** Truncate to maxFiles and warn instead of throwing when the cap is hit. */
    allowPartial?: boolean;
    /**
     * Baseline graph nodes to seed the symbol table with. Used by the
     * `context` command so a slice re-parse resolves call sites against the
     * full repository's symbol set instead of just the slice's. Nodes whose
     * `file_path` matches a slice file are skipped — the slice's fresh
     * extraction overrides the baseline for its own files.
     *
     * Off by default. `parse --all` and `parse --files` (without baseline)
     * keep their original behavior — symbol table is built from extracted
     * symbols only.
     */
    baselineNodes?: GraphNode[];
}

export async function executeParse(opts: ParseOptions): Promise<void> {
    const t0 = performance.now();
    const repoDir = resolve(opts.repoDir);

    // Phase 1: Discover files
    const files = discoverFiles(repoDir, opts.all ? undefined : opts.files, opts.include, opts.exclude, {
        maxFiles: opts.maxFiles,
        allowPartial: opts.allowPartial,
    });
    process.stderr.write(`[1/5] Discovered ${files.length} files\n`);

    // Phase 2: Parse + extract
    let rawGraph = await parseBatch(files, repoDir, { skipTests: opts.skipTests, maxMemoryMB: opts.maxMemoryMB });
    process.stderr.write(
        `[2/5] Parsed ${rawGraph.functions.length} functions, ${rawGraph.classes.length} classes, ${rawGraph.rawCalls.length} call sites\n`,
    );

    // Phase 3: Resolve imports
    const tsconfigAliases = loadTsconfigAliases(repoDir);
    let symbolTable = createSymbolTable();
    let importMap = createImportMap();
    let importEdges: ImportEdge[] = [];

    for (const f of rawGraph.functions) {
        symbolTable.add(f.file, f.name, f.qualified);
    }
    for (const c of rawGraph.classes) {
        symbolTable.add(c.file, c.name, c.qualified);
    }
    for (const i of rawGraph.interfaces) {
        symbolTable.add(i.file, i.name, i.qualified);
    }

    // B8 fix: when invoked with a baseline graph (currently from `context`),
    // seed the symbol table with every callable symbol from baseline files
    // OUTSIDE the slice. Without this, a slice-only table makes every name look
    // unique and the resolver's ambiguity checks stop working.
    if (opts.baselineNodes && opts.baselineNodes.length > 0) {
        const sliceFiles = new Set<string>();
        for (const f of rawGraph.functions) {
            sliceFiles.add(f.file);
        }
        for (const c of rawGraph.classes) {
            sliceFiles.add(c.file);
        }
        for (const i of rawGraph.interfaces) {
            sliceFiles.add(i.file);
        }
        const seeded = seedSymbolTableFromBaseline(symbolTable, opts.baselineNodes, sliceFiles);
        log.debug('parse: seeded symbol table with baseline nodes', {
            seeded,
            baselineTotal: opts.baselineNodes.length,
            sliceFiles: sliceFiles.size,
        });
    }

    // Pre-resolve re-exports so barrel imports follow through to actual definitions
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
            // If target is a barrel file, follow re-exports to find the actual definition
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

    process.stderr.write(
        `[3/5] Resolved ${importEdges.filter((e) => e.resolved).length}/${importEdges.length} imports\n`,
    );

    // Phase 4: Resolve calls
    let { callEdges, stats } = resolveCallsForGraph(rawGraph, symbolTable, importMap);
    process.stderr.write(
        `[4/5] Resolved ${callEdges.length} calls (receiver:${stats.receiver} DI:${stats.di} same:${stats.same} import:${stats.import} unique:${stats.unique} ambiguous:${stats.ambiguous} noise:${stats.noise} ambigNoise:${stats.ambiguousNoise})\n`,
    );

    // Snapshot resolver stats into a plain TierDistribution for the metadata.
    // Stats mirror CallResolverStats 1:1 — we copy by name so the metadata
    // contract doesn't drift if the resolver adds internal fields later.
    const tierDistribution: TierDistribution = {
        receiver: stats.receiver,
        di: stats.di,
        same: stats.same,
        import: stats.import,
        unique: stats.unique,
        ambiguous: stats.ambiguous,
        noise: stats.noise,
        ambiguousNoise: stats.ambiguousNoise,
    };

    // Phase 5: Build output
    const fileHashes = new Map<string, string>();
    for (const f of files) {
        try {
            fileHashes.set(relative(repoDir, f), computeFileHash(f));
        } catch (err) {
            log.warn('Failed to compute file hash', { file: f, error: String(err) });
        }
    }

    const parseErrors = rawGraph.parseErrors;
    const extractErrors = rawGraph.extractErrors;
    // When a baseline is supplied, expose its file paths to the builder so
    // CALLS edges that target outside-slice symbols aren't filtered out
    // (the builder's external-target guard otherwise drops them).
    const baselineFiles = opts.baselineNodes ? new Set(opts.baselineNodes.map((n) => n.file_path)) : undefined;
    const graphData = buildGraphData(
        rawGraph,
        callEdges,
        importEdges,
        repoDir,
        fileHashes,
        symbolTable,
        importMap,
        baselineFiles,
    );
    process.stderr.write(`[5/5] Built graph: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges\n`);

    // Release intermediaries — no longer needed after buildGraphData
    rawGraph = null as any;
    symbolTable = null as any;
    importMap = null as any;
    callEdges = null as any;
    importEdges = null as any;

    const metadata = {
        repo_dir: repoDir,
        files_parsed: files.length,
        total_nodes: graphData.nodes.length,
        total_edges: graphData.edges.length,
        duration_ms: Math.round(performance.now() - t0),
        parse_errors: parseErrors,
        extract_errors: extractErrors,
        schema_version: SCHEMA_VERSION,
        tier_distribution: tierDistribution,
    };

    writeGraphJSON(opts.out, metadata, graphData.nodes, graphData.edges);
}
