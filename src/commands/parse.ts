import { resolve, relative } from 'path';
import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import { discoverFiles } from '../parser/discovery';
import { parseBatch } from '../parser/batch';
import { resolveImport, loadTsconfigAliases } from '../resolver/import-resolver';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { createImportMap } from '../resolver/import-map';
import { buildGraphData } from '../graph/builder';
import { computeFileHash } from '../shared/file-hash';
import type { ParseOutput, ImportEdge } from '../graph/types';

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

  // Phase 2: Parse + extract
  const rawGraph = await parseBatch(files, repoDir);

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
    const resolved = resolveImport(
      resolve(repoDir, imp.file), imp.module, langKey, repoDir, tsconfigAliases
    );
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

  // Phase 4: Resolve calls
  const { callEdges } = await resolveAllCalls(files, repoDir, rawGraph.diMaps, symbolTable, importMap);

  // Phase 5: Build output
  const fileHashes = new Map<string, string>();
  for (const f of files) {
    try { fileHashes.set(relative(repoDir, f), computeFileHash(f)); } catch {}
  }

  const graphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes);

  const output: ParseOutput = {
    metadata: {
      repo_dir: repoDir,
      files_parsed: files.length,
      total_nodes: graphData.nodes.length,
      total_edges: graphData.edges.length,
      duration_ms: Math.round(performance.now() - t0),
    },
    nodes: graphData.nodes,
    edges: graphData.edges,
  };

  writeFileSync(opts.out, JSON.stringify(output, null, 2));
}
