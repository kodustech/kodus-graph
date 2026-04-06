// ── Node kinds (aligned with Postgres ast_nodes.kind) ──
export type NodeKind = 'Function' | 'Method' | 'Constructor' | 'Class' | 'Interface' | 'Enum' | 'Test';

// ── Edge kinds (aligned with Postgres ast_edges.kind) ──
export type EdgeKind = 'CALLS' | 'IMPORTS' | 'INHERITS' | 'IMPLEMENTS' | 'TESTED_BY' | 'CONTAINS';

// ── Graph node (matches ast_nodes table) ──
export interface GraphNode {
  kind: NodeKind;
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
  file_hash: string;
}

// ── Graph edge (matches ast_edges table) ──
export interface GraphEdge {
  kind: EdgeKind;
  source_qualified: string;
  target_qualified: string;
  file_path: string;
  line: number;
  confidence?: number; // 0.0-1.0, only for CALLS
}

// ── Full graph data ──
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Parse command output ──
export interface ParseMetadata {
  repo_dir: string;
  files_parsed: number;
  total_nodes: number;
  total_edges: number;
  duration_ms: number;
  parse_errors: number;
  extract_errors: number;
}

export interface ParseOutput {
  metadata: ParseMetadata;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Analyze command output ──
export interface BlastRadiusResult {
  total_functions: number;
  total_files: number;
  by_depth: Record<string, string[]>;
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

// ── Internal types used during parsing pipeline ──
export interface RawFunction {
  name: string;
  file: string;
  line_start: number;
  line_end: number;
  params: string;
  returnType: string;
  kind: 'Function' | 'Method' | 'Constructor';
  className: string;
  qualified: string;
}

export interface RawClass {
  name: string;
  file: string;
  line_start: number;
  line_end: number;
  extends: string;
  implements: string;
  qualified: string;
}

export interface RawInterface {
  name: string;
  file: string;
  line_start: number;
  line_end: number;
  methods: string[];
  qualified: string;
}

export interface RawEnum {
  name: string;
  file: string;
  line_start: number;
  line_end: number;
  qualified: string;
}

export interface RawTest {
  name: string;
  file: string;
  line_start: number;
  line_end: number;
  qualified: string;
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
  diField?: string; // if DI pattern (this.field.method), the field name
}

export interface RawCallEdge {
  source: string; // file path of the caller
  target: string; // qualified name of the callee
  callName: string;
  line: number;
  confidence: number;
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
