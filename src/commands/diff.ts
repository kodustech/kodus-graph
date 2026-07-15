import type { SgRoot } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { extname, relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { computeStructuralDiff } from '../analysis/diff';
import { buildGraphData } from '../graph/builder';
import { indexGraph, loadGraph } from '../graph/loader';
import type { ImportEdge, RawCallSite, RawGraph } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { extractCallsFromFile, extractFromFile } from '../parser/extractor';
import { getLanguage } from '../parser/languages';
import { resolveCallsForGraph } from '../resolver/call-resolver';
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

/**
 * Fetch a file's content at a given git ref. Returns null when the path does
 * not exist at that ref (typical for files added after the base).
 */
function gitShowAtRef(repoDir: string, ref: string, file: string): string | null {
    try {
        // Use explicit arg separator so weird file names don't confuse git.
        // Buffer cap is high enough to handle large files (e.g. migrations).
        const out = execSync(`git show ${JSON.stringify(`${ref}:${file}`)}`, {
            cwd: repoDir,
            encoding: 'utf-8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return out;
    } catch {
        // Path missing at base ref (added since), or binary / too large.
        return null;
    }
}

/**
 * Parse an in-memory collection of (relPath, source) pairs and build a
 * minimal GraphData suitable for `computeStructuralDiff`. No filesystem I/O
 * is performed. Call resolution is skipped — diff only cares about per-node
 * content_hash / params / return_type / modifiers for structural comparison.
 */
async function buildGraphFromSources(
    sources: Array<{ relPath: string; source: string }>,
    repoDir: string,
): Promise<{ nodes: ReturnType<typeof buildGraphData>['nodes']; edges: ReturnType<typeof buildGraphData>['edges'] }> {
    const raw: RawGraph = {
        functions: [],
        classes: [],
        interfaces: [],
        enums: [],
        tests: [],
        imports: [],
        reExports: [],
        rawCalls: [],
        diMaps: new Map(),

        valueBindings: new Map(),
    };
    const seen = new Set<string>();

    for (const { relPath, source } of sources) {
        const lang = getLanguage(extname(relPath));
        if (!lang) {
            continue;
        }
        let root: SgRoot;
        try {
            root = await parseAsync(lang, source);
        } catch (err) {
            log.warn('diff: failed to parse base-ref source', { file: relPath, error: String(err) });
            continue;
        }
        try {
            extractFromFile(root, relPath, lang, seen, raw);
        } catch (err) {
            log.warn('diff: extraction crashed on base-ref source', { file: relPath, error: String(err) });
        }
        try {
            const calls: RawCallSite[] = [];
            extractCallsFromFile(root, relPath, lang, calls);
            // Not used for diff, but keeps RawGraph shape consistent.
            for (const c of calls) {
                raw.rawCalls.push(c);
            }
        } catch {
            // Diff doesn't need call edges — silent skip.
        }
    }

    // Build nodes only; pass empty call/import edges. Diff compares node-level
    // fields (content_hash/params/return_type/modifiers); edge deltas reported
    // by computeStructuralDiff look at newEdges vs oldGraph.edges, so leaving
    // both empty on the base side is acceptable for the base-ref workflow.
    const data = buildGraphData(raw, [], [], repoDir, new Map(), undefined, undefined);
    return { nodes: data.nodes, edges: data.edges };
}

export async function executeDiff(opts: DiffCommandOptions): Promise<void> {
    const t0 = performance.now();
    const repoDir = resolve(opts.repoDir);

    // Resolve changed files
    let changedFiles: string[];
    if (opts.base) {
        try {
            // Explicit `..HEAD` so direction is unambiguous and includes only
            // commits between base and current HEAD (not working-tree edits).
            const output = execSync(`git diff --name-only ${opts.base}..HEAD`, {
                cwd: repoDir,
                encoding: 'utf-8',
            });
            changedFiles = output.trim().split('\n').filter(Boolean);
        } catch (err) {
            log.error('failed to run git diff', { base: opts.base, error: String(err) });
            process.exit(1);
        }
    } else {
        changedFiles = opts.files!;
    }

    process.stderr.write(`[1/4] ${changedFiles.length} changed files\n`);

    // --- Determine the "old" side ---
    // With --base <ref>: parse each file's content AT THE BASE REF in memory
    //   (via `git show <ref>:<file>`) and build a minimal graph from that.
    // Without --base: load the previously-written graph JSON from disk.
    let oldGraph: ReturnType<typeof loadGraph>;
    if (opts.base) {
        const sources: Array<{ relPath: string; source: string }> = [];
        for (const file of changedFiles) {
            const rel = file.startsWith('/') ? relative(repoDir, file) : file;
            const source = gitShowAtRef(repoDir, opts.base, rel);
            if (source === null) {
                // File didn't exist at base ref — legitimately shows as "added".
                continue;
            }
            sources.push({ relPath: rel, source });
        }
        const baseGraph = await buildGraphFromSources(sources, repoDir);
        oldGraph = indexGraph({ nodes: baseGraph.nodes, edges: baseGraph.edges });
        process.stderr.write(
            `[2/4] Parsed base ref ${opts.base} (${sources.length} files, ${oldGraph.nodes.length} nodes)\n`,
        );
    } else {
        const graphPath = resolve(opts.graph);
        if (!existsSync(graphPath)) {
            log.error('graph file not found', { path: graphPath });
            process.exit(1);
        }
        oldGraph = loadGraph(graphPath);
        process.stderr.write(`[2/4] Loaded previous graph (${oldGraph.nodes.length} nodes)\n`);
    }

    // Re-parse changed files from the WORKING TREE (the "new" side).
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

    const { callEdges } = resolveCallsForGraph(rawGraph, symbolTable, importMap);

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
