// src/graph/loader.ts
import { readFileSync } from 'fs';
import { z } from 'zod';
import { SCHEMA_VERSION } from '../shared/constants';
import { log } from '../shared/logger';
import { compareSchemaVersions } from './schema-version-check';
import type { GraphData, GraphEdge, GraphNode, ParseMetadata } from './types';

const ParseOutputSchema = z.object({
    metadata: z.object({
        schema_version: z.string().optional(),
        repo_dir: z.string(),
        files_parsed: z.number(),
        total_nodes: z.number(),
        total_edges: z.number(),
        duration_ms: z.number(),
        parse_errors: z.number(),
        extract_errors: z.number(),
        files_unchanged: z.number().optional(),
        incremental: z.boolean().optional(),
    }),
    nodes: z.array(
        z.object({
            kind: z.enum(['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Enum', 'Test']),
            name: z.string(),
            qualified_name: z.string(),
            file_path: z.string(),
            line_start: z.number(),
            line_end: z.number(),
            language: z.string(),
            is_test: z.boolean(),
            file_hash: z.string().optional(),
            parent_name: z.string().optional(),
            params: z.string().optional(),
            return_type: z.string().optional(),
            modifiers: z.string().optional(),
        }),
    ),
    edges: z.array(
        z.object({
            kind: z.enum(['CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS', 'TESTED_BY', 'CONTAINS']),
            source_qualified: z.string(),
            target_qualified: z.string(),
            file_path: z.string(),
            line: z.number(),
            confidence: z.number().optional(),
        }),
    ),
});

export interface IndexedGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
    byQualified: Map<string, GraphNode>;
    byFile: Map<string, GraphNode[]>;
    adjacency: Map<string, GraphEdge[]>;
    reverseAdjacency: Map<string, GraphEdge[]>;
    edgesByKind: Map<string, GraphEdge[]>;
    metadata: ParseMetadata;
}

export function indexGraph(data: GraphData, metadata?: ParseMetadata): IndexedGraph {
    const { nodes, edges } = data;
    const meta: ParseMetadata = metadata ?? {
        repo_dir: '',
        files_parsed: 0,
        total_nodes: nodes.length,
        total_edges: edges.length,
        duration_ms: 0,
        parse_errors: 0,
        extract_errors: 0,
    };

    const byQualified = new Map<string, GraphNode>();
    const byFile = new Map<string, GraphNode[]>();
    const adjacency = new Map<string, GraphEdge[]>();
    const reverseAdjacency = new Map<string, GraphEdge[]>();
    const edgesByKind = new Map<string, GraphEdge[]>();

    for (const node of nodes) {
        byQualified.set(node.qualified_name, node);
        const list = byFile.get(node.file_path);
        if (list) {
            list.push(node);
        } else {
            byFile.set(node.file_path, [node]);
        }
    }

    for (const edge of edges) {
        const fwd = adjacency.get(edge.source_qualified);
        if (fwd) {
            fwd.push(edge);
        } else {
            adjacency.set(edge.source_qualified, [edge]);
        }

        const rev = reverseAdjacency.get(edge.target_qualified);
        if (rev) {
            rev.push(edge);
        } else {
            reverseAdjacency.set(edge.target_qualified, [edge]);
        }

        const byKind = edgesByKind.get(edge.kind);
        if (byKind) {
            byKind.push(edge);
        } else {
            edgesByKind.set(edge.kind, [edge]);
        }
    }

    return { nodes, edges, byQualified, byFile, adjacency, reverseAdjacency, edgesByKind, metadata: meta };
}

export function loadGraph(path: string): IndexedGraph {
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
        throw new Error(`Failed to read graph file: ${path} — ${String(err)}`);
    }

    const parsed = ParseOutputSchema.parse(raw);

    const loadedVersion = parsed.metadata.schema_version;
    if (!loadedVersion) {
        log.warn('graph has no schema_version; assuming legacy (pre-1.0). Some features may behave incorrectly.');
    } else {
        const rel = compareSchemaVersions(loadedVersion, SCHEMA_VERSION);
        if (rel === 'newer-major') {
            throw new Error(
                `graph schema v${loadedVersion} is newer than this kodus-graph version (v${SCHEMA_VERSION}). ` +
                    `Upgrade kodus-graph or regenerate the graph with a compatible version.`,
            );
        }
        if (rel === 'older-major') {
            log.warn(
                `graph is v${loadedVersion}, code expects v${SCHEMA_VERSION} (breaking change). ` +
                    `Consider re-running \`kodus-graph parse\` to regenerate.`,
            );
        }
        // older-minor / newer-minor / same -> proceed silently (minor bumps are additive).
    }

    return indexGraph(
        { nodes: parsed.nodes as GraphNode[], edges: parsed.edges as GraphEdge[] },
        parsed.metadata as ParseMetadata,
    );
}
