import { resolve, relative } from 'path';
import { performance } from 'perf_hooks';
import { buildGraphData } from '../graph/builder';
import { writeGraphJSON } from '../graph/json-writer';
import type { ImportEdge } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';

export interface ParseOptions {
  repoDir: string;
  files?: string[];
  all: boolean;
  out: string;
  include?: string[];
  exclude?: string[];
}

export async function executeParse(opts: ParseOptions): Promise<void> {
  const t0 = performance.now();
  const repoDir = resolve(opts.repoDir);

  // Phase 1: Discover files
  const files = discoverFiles(repoDir, opts.all ? undefined : opts.files, opts.include, opts.exclude);
  process.stderr.write(`[1/5] Discovered ${files.length} files\n`);

  // Phase 2: Parse + extract
  let rawGraph = await parseBatch(files, repoDir);
  process.stderr.write(
    `[2/5] Parsed ${rawGraph.functions.length} functions, ${rawGraph.classes.length} classes, ${rawGraph.rawCalls.length} call sites\n`,
  );

  // Phase 3: Resolve imports
  const tsconfigAliases = loadTsconfigAliases(repoDir);
  let symbolTable = createSymbolTable();
  let importMap = createImportMap();
  let importEdges: ImportEdge[] = [];

  for (const f of rawGraph.functions) symbolTable.add(f.file, f.name, f.qualified);
  for (const c of rawGraph.classes) symbolTable.add(c.file, c.name, c.qualified);
  for (const i of rawGraph.interfaces) symbolTable.add(i.file, i.name, i.qualified);

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
    for (const name of imp.names) importMap.add(imp.file, name, target);
  }

  process.stderr.write(
    `[3/5] Resolved ${importEdges.filter((e) => e.resolved).length}/${importEdges.length} imports\n`,
  );

  // Phase 4: Resolve calls
  let { callEdges, stats } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);
  process.stderr.write(
    `[4/5] Resolved ${callEdges.length} calls (DI:${stats.di} same:${stats.same} import:${stats.import} unique:${stats.unique} ambiguous:${stats.ambiguous} noise:${stats.noise})\n`,
  );

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
  const graphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes);
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
  };

  writeGraphJSON(opts.out, metadata, graphData.nodes, graphData.edges);
}
