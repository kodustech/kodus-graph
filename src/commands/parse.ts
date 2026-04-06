import { writeFileSync } from 'fs';
import { relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { buildGraphData } from '../graph/builder';
import type { ImportEdge, ParseOutput } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';

interface ParseOptions {
  repoDir: string;
  files?: string[];
  all: boolean;
  out: string;
}

export async function executeParse(opts: ParseOptions): Promise<void> {
  const t0 = performance.now();
  const repoDir = resolve(opts.repoDir);

  // Phase 1: Discover files
  const files = discoverFiles(repoDir, opts.all ? undefined : opts.files);
  process.stderr.write(`[1/5] Discovered ${files.length} files\n`);

  // Phase 2: Parse + extract
  const rawGraph = await parseBatch(files, repoDir);
  process.stderr.write(
    `[2/5] Parsed ${rawGraph.functions.length} functions, ${rawGraph.classes.length} classes, ${rawGraph.rawCalls.length} call sites\n`,
  );

  // Phase 3: Resolve imports
  const tsconfigAliases = loadTsconfigAliases(repoDir);
  const symbolTable = createSymbolTable();
  const importMap = createImportMap();
  const importEdges: ImportEdge[] = [];

  // Populate symbol table
  for (const f of rawGraph.functions) symbolTable.add(f.file, f.name, f.qualified);
  for (const c of rawGraph.classes) symbolTable.add(c.file, c.name, c.qualified);
  for (const i of rawGraph.interfaces) symbolTable.add(i.file, i.name, i.qualified);

  // Resolve each import
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
  const { callEdges, stats } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);
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

  const graphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes);
  process.stderr.write(`[5/5] Built graph: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges\n`);

  const output: ParseOutput = {
    metadata: {
      repo_dir: repoDir,
      files_parsed: files.length,
      total_nodes: graphData.nodes.length,
      total_edges: graphData.edges.length,
      duration_ms: Math.round(performance.now() - t0),
      parse_errors: rawGraph.parseErrors,
      extract_errors: rawGraph.extractErrors,
    },
    nodes: graphData.nodes,
    edges: graphData.edges,
  };

  writeFileSync(opts.out, JSON.stringify(output, null, 2));
}
