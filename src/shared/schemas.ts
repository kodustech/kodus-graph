import { z } from 'zod';

// ── Node schema (aligned with GraphNode in src/graph/types.ts) ──
export const graphNodeSchema = z.object({
    kind: z.enum(['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Enum', 'Test']),
    ast_kind: z.string().optional(),
    name: z.string(),
    qualified_name: z.string(),
    file_path: z.string(),
    line_start: z.number(),
    line_end: z.number(),
    language: z.string(),
    is_test: z.boolean(),
    file_hash: z.string().optional(),
    content_hash: z.string().optional(),
    parent_name: z.string().optional(),
    params: z.string().optional(),
    return_type: z.string().optional(),
    modifiers: z.string().optional(),
    // New optional fields — optional for backward compatibility with older graphs
    is_exported: z.boolean().optional(),
    is_async: z.boolean().optional(),
    decorators: z.array(z.string()).optional(),
    throws: z.array(z.string()).optional(),
    complexity: z.number().optional(),
});

// ── Edge schema (aligned with GraphEdge in src/graph/types.ts) ──
export const graphEdgeSchema = z.object({
    kind: z.enum(['CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS', 'TESTED_BY', 'CONTAINS']),
    source_qualified: z.string(),
    target_qualified: z.string(),
    file_path: z.string(),
    line: z.number(),
    confidence: z.number().optional(),
    alternatives: z.array(z.string()).optional(),
});

// ── Parse output metadata ──
export const parseMetadataSchema = z.object({
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
});

// ── Full parse-command output (metadata + nodes + edges) ──
export const graphDataSchema = z.object({
    metadata: parseMetadataSchema,
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
});

// ── Legacy input schema (no metadata, with optional sha) ──
// Kept for backward compatibility with callers that read `--graph` input.
export const GraphInputSchema = z.object({
    sha: z.string().optional(),
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
});
