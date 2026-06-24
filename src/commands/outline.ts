import { relative } from 'path';
import { computeBlastRadius } from '../analysis/blast-radius';
import { GraphIndex } from '../analysis/graph-index';
import { buildGraphData } from '../graph/builder';
import { loadGraph } from '../graph/loader';
import type { GraphData, GraphEdge, GraphNode } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';
import { writeOutput } from '../shared/write-output';

export interface OutlineOptions {
    repoDir: string;
    /** Explicit files to outline. Mutually exclusive with `dir`. */
    files?: string[];
    /** Outline every source file under this directory. */
    dir?: string;
    format: 'text' | 'json';
    out: string;
    exportedOnly?: boolean;
    include?: string[];
    exclude?: string[];
    /**
     * Path to an existing graph JSON. When set, each symbol is enriched with
     * its CALLS fan-in / fan-out — the cross-file impact view that a purely
     * syntactic outline cannot produce.
     */
    graph?: string;
    /** With `graph`, also compute each symbol's blast-radius size. Heavier. */
    blast?: boolean;
    /** Blast-radius traversal depth (default 2). */
    maxDepth?: number;
}

/** Cross-file impact metrics for one symbol, sourced from a resolved graph. */
interface SymbolImpact {
    callers: number;
    callees: number;
    blast?: number;
}

/** One symbol in the structural outline (a node, flattened for output). */
interface OutlineSymbol {
    kind: GraphNode['kind'];
    name: string;
    qualified_name: string;
    signature: string;
    line_start: number;
    line_end: number;
    ast_kind?: string;
    is_exported: boolean;
    is_async: boolean;
    is_test: boolean;
    complexity?: number;
    decorators?: string[];
    /** CALLS fan-in (callers), present only when enriched from a graph. */
    callers?: number;
    /** CALLS fan-out (callees), present only when enriched from a graph. */
    callees?: number;
    /** Blast-radius size (downstream functions), present with --blast. */
    blast?: number;
    /** Members (methods / constructors) when this symbol is a class. */
    members?: OutlineSymbol[];
}

interface OutlineFile {
    file: string;
    symbols: OutlineSymbol[];
}

const CONTAINER_KINDS = new Set<GraphNode['kind']>(['Class', 'Interface', 'Enum']);
const MEMBER_KINDS = new Set<GraphNode['kind']>(['Method', 'Constructor']);

/** Build the `name(params): return_type` signature line for a node. */
function signatureOf(n: GraphNode): string {
    if (CONTAINER_KINDS.has(n.kind)) {
        return n.name;
    }
    // Collapse newlines/indentation from multi-line signatures so each symbol
    // stays on one outline line.
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const params = n.params ? norm(n.params) : '';
    const ret = n.return_type ? `: ${norm(n.return_type)}` : '';
    return `${n.name}${params}${ret}`;
}

function toSymbol(n: GraphNode, impacts?: Map<string, SymbolImpact>): OutlineSymbol {
    const impact = impacts?.get(n.qualified_name);
    return {
        kind: n.kind,
        name: n.name,
        qualified_name: n.qualified_name,
        signature: signatureOf(n),
        line_start: n.line_start,
        line_end: n.line_end,
        ast_kind: n.ast_kind,
        is_exported: n.is_exported ?? false,
        is_async: n.is_async ?? false,
        is_test: n.is_test,
        complexity: n.complexity,
        decorators: n.decorators && n.decorators.length > 0 ? n.decorators : undefined,
        callers: impact?.callers,
        callees: impact?.callees,
        blast: impact?.blast,
    };
}

/**
 * Group a file's nodes into a nested outline: classes/interfaces/enums and
 * top-level functions at the root, methods/constructors nested under their
 * declaring class. Everything is line-ordered.
 */
function buildFileOutline(
    file: string,
    nodes: GraphNode[],
    exportedOnly: boolean,
    impacts?: Map<string, SymbolImpact>,
): OutlineFile {
    const byLine = [...nodes].sort((a, b) => a.line_start - b.line_start || a.line_end - b.line_end);

    // Index containers by name so members can attach in O(1). Multiple classes
    // can share a member name across the file, so we still range-check the
    // (usually single) same-named container.
    const containersByName = new Map<string, GraphNode[]>();
    for (const n of byLine) {
        if (!CONTAINER_KINDS.has(n.kind)) {
            continue;
        }
        const arr = containersByName.get(n.name) ?? [];
        arr.push(n);
        containersByName.set(n.name, arr);
    }
    const findContainer = (m: GraphNode): GraphNode | undefined => {
        if (!m.parent_name) {
            return undefined;
        }
        return containersByName
            .get(m.parent_name)
            ?.find((c) => c.line_start <= m.line_start && c.line_end >= m.line_end);
    };

    const memberMap = new Map<GraphNode, GraphNode[]>();
    const attachedMembers = new Set<GraphNode>();
    for (const n of byLine) {
        if (!MEMBER_KINDS.has(n.kind)) {
            continue;
        }
        const container = findContainer(n);
        if (container) {
            if (!memberMap.has(container)) {
                memberMap.set(container, []);
            }
            memberMap.get(container)?.push(n);
            attachedMembers.add(n);
        }
    }

    const passesFilter = (n: GraphNode) => !exportedOnly || (n.is_exported ?? false);

    const symbols: OutlineSymbol[] = [];
    for (const n of byLine) {
        if (MEMBER_KINDS.has(n.kind) && attachedMembers.has(n)) {
            continue; // rendered nested under its container
        }
        if (!passesFilter(n)) {
            continue;
        }
        const sym = toSymbol(n, impacts);
        if (CONTAINER_KINDS.has(n.kind)) {
            const members = (memberMap.get(n) ?? [])
                .filter(passesFilter)
                .map((m) => toSymbol(m, impacts))
                .sort((a, b) => a.line_start - b.line_start);
            if (members.length > 0) {
                sym.members = members;
            }
        }
        symbols.push(sym);
    }

    return { file, symbols };
}

const KIND_LABEL: Record<GraphNode['kind'], string> = {
    Class: 'class',
    Interface: 'interface',
    Enum: 'enum',
    Function: 'fn',
    Method: 'method',
    Constructor: 'ctor',
    Test: 'test',
};

function flagsOf(s: OutlineSymbol): string {
    const flags: string[] = [];
    if (s.is_exported) {
        flags.push('export');
    }
    if (s.is_async) {
        flags.push('async');
    }
    if (s.is_test) {
        flags.push('test');
    }
    if (typeof s.complexity === 'number' && s.complexity > 1) {
        flags.push(`cx${s.complexity}`);
    }
    if (s.decorators && s.decorators.length > 0) {
        flags.push(...s.decorators.map((d) => (d.startsWith('@') ? d : `@${d}`)));
    }
    // Cross-file impact (only when enriched from a graph). `↑` callers (fan-in),
    // `↓` callees (fan-out), `⌀` blast-radius size.
    if (typeof s.callers === 'number' || typeof s.callees === 'number') {
        flags.push(`↑${s.callers ?? 0} ↓${s.callees ?? 0}`);
    }
    if (typeof s.blast === 'number') {
        flags.push(`⌀${s.blast}`);
    }
    return flags.length > 0 ? `  [${flags.join(' ')}]` : '';
}

function renderSymbolText(s: OutlineSymbol, indent: string): string[] {
    const range = `L${s.line_start}-${s.line_end}`;
    const line = `${indent}${KIND_LABEL[s.kind]} ${s.signature}  ${range}${flagsOf(s)}`;
    const lines = [line];
    for (const m of s.members ?? []) {
        lines.push(...renderSymbolText(m, `${indent}    `));
    }
    return lines;
}

function renderText(files: OutlineFile[]): string {
    const blocks: string[] = [];
    for (const f of files) {
        if (f.symbols.length === 0) {
            continue;
        }
        const lines = [f.file];
        for (const s of f.symbols) {
            lines.push(...renderSymbolText(s, '  '));
        }
        blocks.push(lines.join('\n'));
    }
    return blocks.join('\n\n');
}

/**
 * Build a qualified-name → impact map from a resolved graph file: CALLS
 * fan-in (callers) and fan-out (callees) per symbol, plus optional
 * blast-radius size. This is the cross-file enrichment a syntactic outline
 * can't produce on its own.
 *
 * Only `queryNodes` (the symbols actually being outlined) are computed — NOT
 * every node in the graph. With `--blast`, blast-radius is an O(E) traversal
 * per node, so iterating the whole repo graph would be O(V × E) and OOM on a
 * large codebase even when the user asked for a single file.
 */
function buildImpactMap(
    graphPath: string,
    withBlast: boolean,
    maxDepth: number,
    queryNodes: GraphNode[],
): Map<string, SymbolImpact> {
    const idx = loadGraph(graphPath);
    const graphData: GraphData = { nodes: idx.nodes, edges: idx.edges };
    const gi = new GraphIndex(graphData);
    const countCalls = (edges: readonly GraphEdge[] | undefined): number =>
        (edges ?? []).reduce((n, e) => (e.kind === 'CALLS' ? n + 1 : n), 0);

    const impacts = new Map<string, SymbolImpact>();
    for (const node of queryNodes) {
        const qn = node.qualified_name;
        if (impacts.has(qn)) {
            continue;
        }
        const impact: SymbolImpact = {
            callers: countCalls(idx.reverseAdjacency.get(qn)),
            callees: countCalls(idx.adjacency.get(qn)),
        };
        if (withBlast) {
            impact.blast = computeBlastRadius(graphData, [qn], maxDepth, undefined, undefined, {
                index: gi,
            }).total_functions;
        }
        impacts.set(qn, impact);
    }
    return impacts;
}

/**
 * Print a compact structural outline (symbols, signatures, line ranges) for a
 * set of files. Parse-on-demand and local-only — no cross-file resolution —
 * so it's cheap to run on a single file. Mirrors the "structure before the
 * full file" use case that motivates AI-agent outlines, but emitted from the
 * same extraction that powers the rest of the graph.
 */
export async function executeOutline(opts: OutlineOptions): Promise<void> {
    const repoRoot = opts.dir ?? opts.repoDir;
    const files = discoverFiles(repoRoot, opts.files, opts.include, opts.exclude);
    if (files.length === 0) {
        log.warn('No source files found to outline', { repoRoot, files: opts.files });
        writeOutput(opts.out, opts.format === 'json' ? '[]' : '');
        return;
    }

    const rawGraph = await parseBatch(files, repoRoot);

    const fileHashes = new Map<string, string>();
    for (const f of files) {
        try {
            fileHashes.set(relative(repoRoot, f), computeFileHash(f));
        } catch (err) {
            log.warn('Failed to compute file hash', { file: f, error: String(err) });
        }
    }

    // Structural only — empty call/import edges so we skip the resolver
    // entirely. The outline reports what's declared, not what calls what.
    const graphData = buildGraphData(rawGraph, [], [], repoRoot, fileHashes);

    const byFile = new Map<string, GraphNode[]>();
    for (const node of graphData.nodes) {
        if (!byFile.has(node.file_path)) {
            byFile.set(node.file_path, []);
        }
        byFile.get(node.file_path)?.push(node);
    }

    // Optional cross-file enrichment from a resolved graph: CALLS fan-in /
    // fan-out, and (with --blast) blast-radius size. This is the part a purely
    // syntactic outline can't do.
    const impacts = opts.graph
        ? buildImpactMap(opts.graph, opts.blast ?? false, opts.maxDepth ?? 2, graphData.nodes)
        : undefined;

    const outlines: OutlineFile[] = [...byFile.keys()]
        .sort()
        .map((file) => buildFileOutline(file, byFile.get(file) ?? [], opts.exportedOnly ?? false, impacts))
        .filter((o) => o.symbols.length > 0);

    const content = opts.format === 'json' ? JSON.stringify(outlines, null, 2) : renderText(outlines);
    writeOutput(opts.out, content);

    const symbolCount = outlines.reduce(
        (sum, o) => sum + o.symbols.reduce((s, sym) => s + 1 + (sym.members?.length ?? 0), 0),
        0,
    );
    process.stderr.write(`outline: ${symbolCount} symbols across ${outlines.length} files\n`);
}
