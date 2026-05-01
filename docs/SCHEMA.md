# Schema Reference

Authoritative reference for every payload kodus-graph reads or writes. All shapes are defined as TypeScript interfaces in `src/graph/types.ts` and validated by Zod schemas in `src/shared/schemas.ts`.

**Schema version**: `2.0` (pinned in `src/shared/constants.ts`). Loaders enforce major-version compatibility — graphs from v1.x are rejected; v2.x is accepted with warnings on minor mismatches.

## Index

- [Core graph types](#core-graph-types) — `GraphNode`, `GraphEdge`, `GraphData`
- [Parse output](#parse-output) — what `parse` and `update` write
- [Analyze output](#analyze-output) — what `analyze` writes
- [Context output](#context-output) — what `context` writes
- [Internal raw types](#internal-raw-types) — used during the pipeline; not stable consumer surface
- [Field-by-field semantics](#field-by-field-semantics) — confidence, tier, content_hash, throws
- [Versioning](#versioning) — schema bumps and migration policy

---

## Core graph types

### `NodeKind`

```ts
type NodeKind = 'Function' | 'Method' | 'Constructor' | 'Class' | 'Interface' | 'Enum' | 'Test'
```

Test nodes are emitted only for functions matched by language-specific test detection (file-pattern + function-name pattern + annotation). Constructors are split out from Methods to support constructor-specific analysis.

### `EdgeKind`

```ts
type EdgeKind = 'CALLS' | 'IMPORTS' | 'INHERITS' | 'IMPLEMENTS' | 'TESTED_BY' | 'CONTAINS'
```

### `EdgeTier`

```ts
type EdgeTier = 'receiver' | 'di' | 'same' | 'import' | 'unique' | 'ambiguous'
```

The 5-tier resolver's outcomes that produce edges. `noise` and `ambiguousNoise` are *drop* outcomes (no edge); they appear in `tier_distribution` but never on edges.

### `GraphNode`

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `NodeKind` | ✓ | |
| `ast_kind` | `string` | optional | Underlying tree-sitter node kind, kept for debugging |
| `name` | `string` | ✓ | Symbol name |
| `qualified_name` | `string` | ✓ | Stable identifier: `<file_path>::<Class>.<member>` or `<file_path>::<symbol>` |
| `file_path` | `string` | ✓ | Repo-relative path |
| `line_start` | `number` | ✓ | 0-indexed |
| `line_end` | `number` | ✓ | |
| `language` | `string` | ✓ | One of the keys in the [language matrix](language-support-matrix.md) |
| `is_test` | `boolean` | ✓ | Detected via per-language file/func/annotation patterns |
| `parent_name` | `string` | optional | Enclosing class/module for display disambiguation |
| `params` | `string` | optional | Verbatim parameter list (e.g., `(x: number, opts?: Opts)`) |
| `return_type` | `string` | optional | Verbatim return-type annotation (used by chain-pass receiver inference) |
| `modifiers` | `string` | optional | Verbatim modifier list (`public`, `static`, `final`, `async`, etc.) |
| `file_hash` | `string` | optional | sha256 of file contents (used by `update` to skip unchanged files) |
| `content_hash` | `string` | optional | sha256 of node text (used by diff to detect body changes) |
| `is_exported` | `boolean` | optional | Public-API marker (per-language: `export`, `pub`, capital first letter for Go, etc.) |
| `is_async` | `boolean` | optional | `async` keyword OR Promise/Future return type |
| `decorators` | `string[]` | optional | Annotations / attributes (verbatim, including `@`) |
| `throws` | `string[]` | optional | Exception types thrown (Java `throws` clause, JSDoc `@throws`, etc.) |
| `complexity` | `number` | optional | Cyclomatic complexity (per-language branch-kind enumeration) |

### `GraphEdge`

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `EdgeKind` | ✓ | |
| `source_qualified` | `string` | ✓ | Caller / parent / test |
| `target_qualified` | `string` | ✓ | Callee / child / tested |
| `file_path` | `string` | ✓ | File where the edge originates |
| `line` | `number` | ✓ | Source line of the call / import / declaration |
| `confidence` | `number` | optional, CALLS only | 0.0 – 1.0 |
| `tier` | `EdgeTier` | optional, CALLS only | Which resolver tier produced this edge |
| `alternatives` | `string[]` | optional, CALLS at the ambiguous tier only | Sorted, non-picked candidates |

`tier` was added in schema v2.0 (2026-04-30). Old graphs without it remain readable; consumers that key on `tier` should default to `unknown`.

### `GraphData`

```ts
interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

The minimal in-memory shape. Persisted as `parseOutput.{nodes,edges}` plus `metadata`.

---

## Parse output

Written by `kodus-graph parse` and `kodus-graph update`.

### `ParseOutput`

```ts
interface ParseOutput {
  metadata: ParseMetadata;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

### `ParseMetadata`

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | `string` | optional | Major-version-checked on load |
| `repo_dir` | `string` | ✓ | Absolute path to the repo root that produced this graph |
| `files_parsed` | `number` | ✓ | |
| `total_nodes` | `number` | ✓ | |
| `total_edges` | `number` | ✓ | |
| `duration_ms` | `number` | ✓ | |
| `parse_errors` | `number` | ✓ | Tree-sitter parse failures (kept; output may be partial) |
| `extract_errors` | `number` | ✓ | Per-language extractor exceptions |
| `files_unchanged` | `number` | optional | Set by `update`; absent on full `parse` |
| `incremental` | `boolean` | optional | True for `update` output |
| `tier_distribution` | `TierDistribution` | optional | See below |

### `TierDistribution`

```ts
interface TierDistribution {
  receiver: number;
  di: number;
  same: number;
  import: number;
  unique: number;
  ambiguous: number;
  noise: number;
  ambiguousNoise: number;
}
```

Counts of resolver outcomes across the parse run. In `update` output this reflects the merged graph (each surviving edge contributes its persisted `tier`); `noise` / `ambiguousNoise` reflect the slice only because they don't produce edges.

Useful as a per-repo trust signal. Static-typed languages skew toward `receiver` / `di` / `same` / `import`; dynamic languages skew toward `unique` / `ambiguous` / `noise`.

---

## Analyze output

Written by `kodus-graph analyze`.

### `AnalysisOutput`

```ts
interface AnalysisOutput {
  blast_radius: BlastRadiusResult;
  risk_score: RiskScoreResult;
  test_gaps: TestGap[];
}
```

### `BlastRadiusResult` and `BlastRadiusEntry`

```ts
interface BlastRadiusResult {
  total_functions: number;
  total_files: number;
  by_depth: Record<string, BlastRadiusEntry[]>;  // "1", "2", "3", ...
}

interface BlastRadiusEntry {
  qualified_name: string;
  accumulated_confidence: number;             // multiplied across the path
  edge_kind: 'CALLS' | 'IMPORTS';
  impact_category: ImpactCategory;
  flows: FlowRef[];                           // entry points reaching this fn
  impact_score: number;
}

type ImpactCategory = 'contract_breaking' | 'behavior_affected' | 'transitive'
```

`accumulated_confidence` is the product of edge confidences along the shortest reverse path from the changed function. Filtered by `--min-confidence` at the consumer level.

### `RiskScoreResult`

```ts
interface RiskScoreResult {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;                              // 0.0 - 1.0
  factors: {
    blast_radius: RiskFactor;                 // weight 0.35 default
    test_gaps:    RiskFactor;                 // weight 0.30
    complexity:   RiskFactor;                 // weight 0.20
    inheritance:  RiskFactor;                 // weight 0.15
  };
}

interface RiskFactor {
  weight: number;                             // overridable via --risk-config
  value:  number;                             // 0.0 - 1.0
  detail: string;                             // human-readable justification
}
```

Weights override via `--risk-config <path>` (a JSON object). The shape is validated with Zod; unknown keys cause an error.

### `TestGap`

```ts
interface TestGap {
  function: string;       // qualified name
  file_path: string;
  line_start: number;
}
```

Changed functions that have no inbound `TESTED_BY` edge.

---

## Context output

Written by `kodus-graph context`.

### `ContextOutput`

```ts
interface ContextOutput {
  text: string;                               // formatted body (prompt | xml | json)
  metadata: ContextMetadata;
}
```

`text` content depends on `--format`:
- `prompt`: human-readable, designed for LLM context windows
- `xml`: structured tags `<Imports>`, `<Hierarchy>`, `<Callers>`, etc.
- `json`: serialized `EnrichedFunction[]` + analysis

### `ContextMetadata`

```ts
interface ContextMetadata {
  changed_functions: number;
  caller_count: number;
  callee_count: number;
  untested_count: number;
  blast_radius: { functions: number; files: number };
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  risk_score: number;
}
```

### `EnrichedFunction` (inside `text` when `--format json`)

```ts
interface EnrichedFunction {
  qualified_name: string;
  name: string;
  parent_name?: string;
  kind: NodeKind;
  signature: string;
  file_path: string;
  line_start: number;
  line_end: number;
  callers: CallerRef[];
  callees: CalleeRef[];
  has_test_coverage: boolean;
  diff_changes: string[];                     // 'body' | 'params' | 'return_type' | 'modifiers' | 'is_async' | 'decorators'
  contract_diffs: ContractDiff[];
  caller_impact?: string;                     // human summary
  is_new: boolean;
  in_flows: string[];                         // entry-point qualified names
}

interface CallerRef {
  qualified_name: string;
  name: string;
  file_path: string;
  line: number;
  confidence: number;
  alternatives?: string[];                    // mirrors GraphEdge.alternatives
}

interface CalleeRef {
  qualified_name: string;
  name: string;
  file_path: string;
  signature: string;
}
```

---

## Internal raw types

These are exported for library consumers but should be treated as **unstable**. They mirror the parser's intermediate representation before edge construction.

`RawFunction`, `RawClass`, `RawInterface`, `RawEnum`, `RawTest`, `RawImport`, `RawReExport`, `RawCallSite`, `RawCallEdge`, `ImportEdge`, `RawGraph`, `ParseBatchResult` — see `src/graph/types.ts:253–397`.

`RawCallSite` carries resolver hints set by per-language extractors:

| Hint | Set when |
|---|---|
| `receiverType` | Var-from-new, typed param, factory-deferred (`@CALLEE:`), type cast `as Foo`, static call `Foo.method()`, method-chain return type |
| `diField` | `this.field.method()` patterns |
| `resolveInClass` | `self.method()` / `super.method()` (the className) |
| `chainedFromLine` / `chainedFromColumn` | The receiver of the call is itself a method invocation (chain) |

These are extractor-internal; downstream consumers should rely on the resolved `GraphEdge.tier` and `confidence` instead.

---

## Field-by-field semantics

### `confidence` — what each value means in practice

| Range | Tiers | Read it as |
|---|---|---|
| 0.95 | receiver direct, di direct | "Type is known; this method exists on that type" |
| 0.90 | receiver direct (multiple targets), di-impl heuristic, import-with-symbol-table-hit, same-file-via-class | "Type known but multiple impls match (alternatives populated), or strong indirect signal" |
| 0.85 | inheritance lookup, same-file declared, import-with-target-but-symbol-not-in-table | "Found via declared file/class context" |
| 0.70 | import-only (target file resolved but symbol not in symbol table) | "We know which file the import points at, not whether the symbol is defined there" |
| 0.60 | unique-name, same-directory caller | "Only one definition in the codebase, in the caller's directory" |
| 0.50 | unique-name | "Only one definition in the codebase, anywhere" |
| 0.30 | ambiguous | "Multiple candidates; closest by path proximity, alternatives populated" |

LLM consumers should generally filter to ≥ 0.5 (`--min-confidence`) for blast-radius computation; ambiguous edges are useful for "what was considered" prompts but noisy for impact analysis.

### `tier_distribution` — calibration heuristics

A repo's distribution shape characterizes its trustworthiness:

- **Healthy static-typed**: `receiver` + `di` + `same` + `import` ≥ 50% of total resolved
- **Healthy dynamic-typed**: `same` + `import` + `unique` dominate; `ambiguous` < 35%
- **Noisy**: `noise` + `ambiguousNoise` > 30% of all call sites — most calls were dropped pre-edge

A recent validation (2026-04-30) saw sentry/Python at 27.4% ambiguous (PASS), keycloak/Java at 74.1% (GAP), kotlinx.coroutines at 66.3% (GAP). See `docs/NEXT-STEPS.md` for diagnosis.

### `content_hash` vs `file_hash`

- **`file_hash`**: sha256 of the entire file contents. Used by `update` to skip files that haven't changed.
- **`content_hash`**: sha256 of the node's verbatim text. Used by `diff` to detect body changes when the line range moved.

A function with the same body but a different position will have the same `content_hash` and a different line range — `diff` reports it as `[moved]` rather than `[modified]`.

### `throws` extraction policy

| Language | Source |
|---|---|
| Java/Kotlin | `throws` clause in signature |
| TypeScript/JavaScript | JSDoc `@throws` |
| C# | `throw` statements + XMLdoc `<exception>` |
| Python | Bare `raise` statements (best-effort) |
| Others | Empty array |

---

## Versioning

The schema version follows semver-style for **graph compatibility** (not the npm package version):

- **Major bump (1.0 → 2.0)**: Existing fields change shape or semantics. Consumers reject older graphs by default; opt-in tolerant mode is allowed but discouraged.
- **Minor bump (2.0 → 2.1)**: New optional fields. Consumers reading older graphs see `undefined`; consumers reading newer graphs ignore unknown fields.
- **Patch**: No schema-level change; bug fixes in defaults or extraction.

Current: **2.0**. The `tier` field on `GraphEdge` was added in 2.0 as an optional field; pre-2.0 graphs simply lack it.

The version is set in `src/shared/constants.ts:SCHEMA_VERSION` and stamped onto every `parse` / `update` output via `metadata.schema_version`. Loaders (`loadGraph`) call `enforceSchemaVersion` which:

- Rejects (exit 1) if the major doesn't match.
- Warns if the minor is older than the current parser's minor.
- Accepts silently if patch differs.

When changing the schema, bump both `SCHEMA_VERSION` and update this file.
