import { readFileSync, writeFileSync } from 'fs';
import { relative, resolve } from 'path';
import { computeBlastRadius } from '../analysis/blast-radius';
import { computeRiskScore } from '../analysis/risk-score';
import { findTestGaps } from '../analysis/test-gaps';
import { buildGraphData } from '../graph/builder';
import { mergeGraphs } from '../graph/merger';
import type { AnalysisOutput, ImportEdge, MainGraphInput } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { buildReExportMap } from '../resolver/re-export-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';
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
        } catch (_err) {
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

    // Resolve imports
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

    // Pre-resolve re-exports so barrel imports follow through to actual definitions
    const barrelMap = buildReExportMap(rawGraph.reExports, repoDir, tsconfigAliases);

    for (const imp of rawGraph.imports) {
        const langKey = imp.lang === 'python' ? 'python' : imp.lang === 'ruby' ? 'ruby' : 'typescript';
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

    // Resolve calls
    const { callEdges } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);

    // Build graph with file hashes
    const fileHashes = new Map<string, string>();
    for (const f of localFiles) {
        try {
            fileHashes.set(relative(repoDir, f), computeFileHash(f));
        } catch (err) {
            log.warn('Failed to compute file hash', { file: f, error: String(err) });
        }
    }

    const localGraphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes);

    // Merge with main graph (or use local only)
    const mergedGraph = mainGraph ? mergeGraphs(mainGraph, localGraphData, opts.files) : localGraphData;

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
