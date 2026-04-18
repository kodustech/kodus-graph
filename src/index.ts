// Public library entry point for @kodus/kodus-graph.
//
// Use this for programmatic access to the same commands exposed by the CLI.
// Info/progress logs are written to stderr (see `src/shared/logger.ts`) so
// stdout stays clean for piping.

export type { ContractDiff, DiffResult, ModifiedNode } from './analysis/diff';
export { GraphIndex } from './analysis/graph-index';
export { executeAnalyze } from './commands/analyze';
export { executeCommunities } from './commands/communities';
export { executeContext } from './commands/context';
export { executeDiff } from './commands/diff';
export { executeFlows } from './commands/flows';
// ── Command handlers (for programmatic use) ──
export { executeParse } from './commands/parse';
export { executeSearch } from './commands/search';
export { executeUpdate } from './commands/update';
// ── Core utilities (may be useful to consumers) ──
export { loadGraph } from './graph/loader';
export { mergeGraphs } from './graph/merger';
// ── Core types (for consumers) ──
export type {
    AnalysisOutput,
    BlastRadiusResult,
    ContextOutput,
    EdgeKind,
    EnrichedFunction,
    FlowRef,
    GraphData,
    GraphEdge,
    GraphNode,
    NodeKind,
    ParseMetadata,
    ParseOutput,
    RiskScoreResult,
} from './graph/types';
export type { LanguageCapabilities } from './languages/capabilities';
// ── Language capability registry ──
export { getCapabilitiesFor } from './languages/capabilities';

// ── Schemas (for validation) ──
export { graphDataSchema, graphEdgeSchema, graphNodeSchema } from './shared/schemas';
