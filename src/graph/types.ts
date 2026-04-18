import type { ContractDiff } from '../analysis/diff';

// ── Node kinds (aligned with Postgres ast_nodes.kind) ──
export type NodeKind = 'Function' | 'Method' | 'Constructor' | 'Class' | 'Interface' | 'Enum' | 'Test';

// ── Edge kinds (aligned with Postgres ast_edges.kind) ──
export type EdgeKind = 'CALLS' | 'IMPORTS' | 'INHERITS' | 'IMPLEMENTS' | 'TESTED_BY' | 'CONTAINS';

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
export interface GraphEdge {
    kind: EdgeKind;
    source_qualified: string;
    target_qualified: string;
    file_path: string;
    line: number;
    confidence?: number; // 0.0-1.0, only for CALLS
    /** Non-picked candidates when confidence is low (CALLS edges at the ambiguous tier). */
    alternatives?: string[];
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
    edge_kind: 'CALLS' | 'IMPORTS';
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
    /** Non-picked resolver candidates — mirrors GraphEdge.alternatives for ambiguous CALLS. */
    alternatives?: string[];
}

export interface CalleeRef {
    qualified_name: string;
    name: string;
    file_path: string;
    signature: string;
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
    resolveInClass?: string; // class to resolve in: current class for self.X(), parent for super().X()
    /**
     * Inferred type of the receiver object (e.g. 'Foo' for `x.method()` where `x: Foo`).
     * Populated by the parser batch after call extraction, using the per-file
     * receiver-type map returned by `LanguageExtractors.extractReceiverTypes`.
     * Consumed by the resolver's receiver-aware tier (0.95 / 0.90 confidence).
     */
    receiverType?: string;
}

export interface RawCallEdge {
    source: string; // file path of the caller
    target: string; // qualified name of the callee
    callName: string;
    line: number;
    confidence: number;
    /** Non-picked candidates at the ambiguous tier; useful for LLM consumers to see what was passed over. */
    alternatives?: string[];
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
}

export interface ParseBatchResult extends RawGraph {
    parseErrors: number;
    extractErrors: number;
}
