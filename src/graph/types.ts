import type { ContractDiff } from '../analysis/diff';

// ── Node kinds (aligned with Postgres ast_nodes.kind) ──
export const NODE_KINDS = ['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Enum', 'Test'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

// ── Edge kinds (aligned with Postgres ast_edges.kind) ──
//
// The single list. Zod schemas in `graph/loader` and `shared/schemas` derive
// from it — they used to spell the members out again, so adding `USES_TYPE` to
// the type left both validators rejecting graphs this very code had just
// written, and `analyze --graph` fell back to a graph-less path rather than
// failing on the mismatch.
export const EDGE_KINDS = [
    'CALLS',
    'IMPORTS',
    'INHERITS',
    'IMPLEMENTS',
    'TESTED_BY',
    'CONTAINS',
    /** A function's signature names a type this repo declares. See `graph/edges.ts`. */
    'USES_TYPE',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

// ── Graph node (matches ast_nodes table) ──
export interface GraphNode {
    kind: NodeKind;
    ast_kind?: string;
    name: string;
    qualified_name: string;
    file_path: string;
    line_start: number;
    line_end: number;
    language: string;
    parent_name?: string;
    params?: string;
    return_type?: string;
    modifiers?: string;
    is_test: boolean;
    file_hash?: string;
    content_hash?: string;
    is_exported?: boolean;
    is_async?: boolean;
    decorators?: string[];
    throws?: string[];
    complexity?: number;
}

// ── Graph edge (matches ast_edges table) ──
/**
 * Resolution tier for a CALLS edge — the resolver pipeline stage that produced
 * it. Persisted on each edge so consumers (and `kodus-graph update`) can
 * recompute `tier_distribution` over a merged graph without rerunning the
 * resolver. `noise` and `ambiguousNoise` are *drop* outcomes (no edge), so
 * they don't appear here.
 */
export type EdgeTier = 'receiver' | 'di' | 'same' | 'import' | 'unique' | 'ambiguous';

export interface GraphEdge {
    kind: EdgeKind;
    source_qualified: string;
    target_qualified: string;
    file_path: string;
    line: number;
    confidence?: number; // 0.0-1.0, only for CALLS
    /** Non-picked candidates when confidence is low (CALLS edges at the ambiguous tier). */
    alternatives?: string[];
    /** Resolution tier — only set for CALLS edges. Optional for backward compat with pre-2026-04 graphs. */
    tier?: EdgeTier;
}

// ── Full graph data ──
export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

// ── Parse command output ──

/**
 * Per-tier counts of call resolution outcomes. Useful for calibrating trust
 * in the graph: a repo skewed toward `ambiguous`/`noise` has more uncertainty
 * than one skewed toward `receiver`/`di`/`same`/`import`.
 *
 * Fields mirror `CallResolverStats` in `src/resolver/call-resolver.ts`.
 */
export interface TierDistribution {
    receiver: number;
    di: number;
    same: number;
    import: number;
    unique: number;
    ambiguous: number;
    noise: number;
    ambiguousNoise: number;
}

export interface ParseMetadata {
    /** Kodus-graph schema version. See src/shared/constants.ts. */
    schema_version?: string;
    repo_dir: string;
    files_parsed: number;
    total_nodes: number;
    total_edges: number;
    duration_ms: number;
    parse_errors: number;
    extract_errors: number;
    files_unchanged?: number;
    incremental?: boolean;
    /**
     * Per-tier resolver counts across the parse run. In incremental updates
     * (`kodus-graph update`) this reflects ONLY the re-parsed slice, not the
     * full graph — re-run `kodus-graph parse --all` for a complete picture.
     * See `TierDistribution`.
     */
    tier_distribution?: TierDistribution;
}

export interface ParseOutput {
    metadata: ParseMetadata;
    nodes: GraphNode[];
    edges: GraphEdge[];
}

// ── Analyze command output ──
export type FlowType = 'test' | 'http';

export interface FlowRef {
    entry_point: string;
    type: FlowType;
    criticality: number;
}

export type ImpactCategory = 'contract_breaking' | 'behavior_affected' | 'transitive';

export interface BlastRadiusEntry {
    qualified_name: string;
    accumulated_confidence: number;
    /** How the change reaches this symbol: it calls it, imports it, names it in a signature, or inherits from it. */
    edge_kind: 'CALLS' | 'IMPORTS' | 'USES_TYPE' | 'INHERITS';
    impact_category: ImpactCategory;
    flows: FlowRef[];
    impact_score: number;
}

export interface BlastRadiusResult {
    total_functions: number;
    total_files: number;
    by_depth: Record<string, BlastRadiusEntry[]>;
}

export interface RiskFactor {
    weight: number;
    value: number;
    detail: string;
}

export interface RiskScoreResult {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    score: number;
    factors: {
        blast_radius: RiskFactor;
        test_gaps: RiskFactor;
        complexity: RiskFactor;
        inheritance: RiskFactor;
    };
}

export interface TestGap {
    function: string;
    file_path: string;
    line_start: number;
}

export interface AnalysisOutput {
    blast_radius: BlastRadiusResult;
    risk_score: RiskScoreResult;
    test_gaps: TestGap[];
}

// ── Context command output ──
export interface ContextMetadata {
    changed_functions: number;
    caller_count: number;
    callee_count: number;
    untested_count: number;
    blast_radius: { functions: number; files: number };
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
    risk_score: number;
}

export interface ContextOutput {
    text: string;
    metadata: ContextMetadata;
}

// ── Main graph JSON (input --graph, from Postgres) ──
export interface MainGraphInput {
    repo_id: string;
    sha: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
}

// ── Context V2 types ──
export interface CallerRef {
    qualified_name: string;
    name: string;
    file_path: string;
    line: number;
    confidence: number;
    /** How the resolver reached this edge. Mirrors GraphEdge.tier. */
    tier?: EdgeTier;
    /** Non-picked resolver candidates — mirrors GraphEdge.alternatives for ambiguous CALLS. */
    alternatives?: string[];
}

export interface CalleeRef {
    qualified_name: string;
    name: string;
    file_path: string;
    signature: string;
    /**
     * Resolver confidence, same scale as CallerRef.
     *
     * Callees previously carried no confidence at all, so a 0.60 unique-name
     * guess and a 0.95 receiver-typed resolution reached consumers as equally
     * asserted fact — the resolver does the work of five tiers and the callee
     * direction threw it away.
     */
    confidence: number;
    /** How the resolver reached this edge. Mirrors GraphEdge.tier. */
    tier?: EdgeTier;
}

export interface EnrichedFunction {
    qualified_name: string;
    name: string;
    /** Enclosing class/module name when applicable — used for display disambiguation. */
    parent_name?: string;
    kind: NodeKind;
    signature: string;
    file_path: string;
    line_start: number;
    line_end: number;
    callers: CallerRef[];
    callees: CalleeRef[];
    has_test_coverage: boolean;
    diff_changes: string[];
    contract_diffs: ContractDiff[];
    caller_impact?: string;
    is_new: boolean;
    in_flows: string[];
    /**
     * Whether the symbol is part of the module's public surface.
     *
     * Load-bearing for reading `callers`: for a non-exported symbol the caller
     * list is the whole story, and an empty one means nothing calls it. For an
     * exported symbol it is a LOWER BOUND — the graph only sees this repository,
     * and a package consumer, a dynamic import, or a downstream service is
     * invisible to it. "No callers" means "no callers here", not "unused".
     */
    is_exported?: boolean;
}

export interface AffectedFlow {
    entry_point: string;
    type: FlowType;
    touches_changed: string[];
    depth: number;
    path: string[];
}

export interface InheritanceEntry {
    qualified_name: string;
    file_path: string;
    extends?: string;
    implements: string[];
    children: string[];
}

export interface ContextAnalysisMetadata {
    changed_functions_count: number;
    total_callers: number;
    total_callees: number;
    untested_count: number;
    affected_flows_count: number;
    duration_ms: number;
    min_confidence: number;
}

// ── Internal types used during parsing pipeline ──
export interface RawFunction {
    name: string;
    file: string;
    line_start: number;
    line_end: number;
    params: string;
    returnType: string;
    kind: 'Function' | 'Method' | 'Constructor';
    ast_kind: string;
    className: string;
    qualified: string;
    modifiers?: string;
    content_hash?: string;
    is_exported?: boolean;
    is_async?: boolean;
    decorators?: string[];
    throws?: string[];
    complexity?: number;
}

export interface RawClass {
    name: string;
    file: string;
    line_start: number;
    line_end: number;
    extends: string;
    implements: string[];
    ast_kind: string;
    qualified: string;
    modifiers?: string;
    content_hash?: string;
    is_exported?: boolean;
    decorators?: string[];
}

export interface RawInterface {
    name: string;
    file: string;
    line_start: number;
    line_end: number;
    methods: string[];
    ast_kind: string;
    qualified: string;
    content_hash?: string;
    is_exported?: boolean;
}

export interface RawEnum {
    name: string;
    file: string;
    line_start: number;
    line_end: number;
    ast_kind: string;
    qualified: string;
    content_hash?: string;
    is_exported?: boolean;
}

export interface RawTest {
    name: string;
    file: string;
    line_start: number;
    line_end: number;
    ast_kind: string;
    qualified: string;
    content_hash?: string;
}

export interface RawImport {
    module: string;
    file: string;
    line: number;
    names: string[];
    lang: string;
}

export interface RawReExport {
    module: string;
    file: string;
    line: number;
}

export interface RawCallSite {
    source: string; // relative file path
    callName: string; // function or method name being called
    line: number; // line number of the call
    column?: number; // column number of the call (optional — used to key receiver-type inference)
    diField?: string; // if DI pattern (this.field.method), the field name
    diClass?: string; // class enclosing a this.field.method() call — disambiguates the per-class diMap
    resolveInClass?: string; // class to resolve in: current class for self.X(), parent for super().X()
    /**
     * Inferred type of the receiver object (e.g. 'Foo' for `x.method()` where `x: Foo`).
     * Populated by the parser batch after call extraction, using the per-file
     * receiver-type map returned by `LanguageExtractors.extractReceiverTypes`.
     * Consumed by the resolver's receiver-aware tier (0.95 / 0.90 confidence).
     */
    receiverType?: string;
    /**
     * Location of the inner call this site is chained from, for `x.a().b()`
     * patterns. Populated by language extractors when a call's receiver is
     * itself a call expression. The resolver uses this in a second pass to
     * propagate the inner call's resolved return type as the outer call's
     * receiverType, closing the chain-receiver gap.
     */
    chainedFromLine?: number;
    chainedFromColumn?: number;
}

export interface RawCallEdge {
    source: string; // file path of the caller
    target: string; // qualified name of the callee
    callName: string;
    line: number;
    confidence: number;
    /** Non-picked candidates at the ambiguous tier; useful for LLM consumers to see what was passed over. */
    alternatives?: string[];
    /**
     * Resolution tier (receiver / di / same / import / unique / ambiguous).
     * Optional only to keep test fixtures simple; the resolver always sets it.
     */
    tier?: EdgeTier;
}

export interface ImportEdge {
    source: string; // source file
    target: string; // resolved target file or unresolved module
    resolved: boolean;
    line: number;
}

export interface RawGraph {
    functions: RawFunction[];
    classes: RawClass[];
    interfaces: RawInterface[];
    enums: RawEnum[];
    tests: RawTest[];
    imports: RawImport[];
    reExports: RawReExport[];
    rawCalls: RawCallSite[];
    diMaps: Map<string, Map<string, string>>; // file -> Map<fieldName, typeName>
    /**
     * Module-level value bindings per file: `file -> Map<varName, type>`.
     * Cross-file resolution: when a call's receiver is an imported name, the
     * resolver consults `valueBindings.get(sourceFile).get(varName)` to find
     * the type. Type may be a concrete name (`Database`) or a deferred
     * marker (`@CALLEE:foo`).
     */
    valueBindings: Map<string, Map<string, string>>;
}

export interface ParseBatchResult extends RawGraph {
    parseErrors: number;
    extractErrors: number;
}
