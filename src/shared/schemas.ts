import { z } from 'zod';

const GraphNodeSchema = z.object({
  kind: z.enum(['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Enum', 'Test']),
  name: z.string(),
  qualified_name: z.string(),
  file_path: z.string(),
  line_start: z.number(),
  line_end: z.number(),
  language: z.string(),
  is_test: z.boolean(),
  file_hash: z.string(),
  content_hash: z.string().optional(),
  parent_name: z.string().optional(),
  params: z.string().optional(),
  return_type: z.string().optional(),
  modifiers: z.string().optional(),
});

const GraphEdgeSchema = z.object({
  kind: z.enum(['CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS', 'TESTED_BY', 'CONTAINS']),
  source_qualified: z.string(),
  target_qualified: z.string(),
  file_path: z.string(),
  line: z.number(),
  confidence: z.number().optional(),
});

export const GraphInputSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
