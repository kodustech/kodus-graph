# Schema Reference

Authoritative reference for every payload kodus-graph reads or writes. All shapes are defined as TypeScript interfaces in `src/graph/types.ts` and validated by Zod schemas in `src/shared/schemas.ts`.

**Schema version**: `2.1` (pinned in `src/shared/constants.ts`). Loaders enforce major-version compatibility — graphs from v1.x are rejected; v2.x is accepted with warnings on minor mismatches.

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
type EdgeKind = 'CALLS' | 'IMPORTS' | 'INHERITS' | 'IMPLEMENTS' | 'TESTED_BY' | 'CONTAINS' | 'USES_TYPE'
```

### `EdgeTier`

```ts
type EdgeTier = 'receiver' | 'di' | 'same' | 'import' | 'unique' | 'ambiguous'
```

The 5-tier resolver's outcomes that produce edges. `noise` and `ambiguousNoise` are *drop* outcomes (no edge); they appear in `tier_distribution` but never on edges. `USES_TYPE` edges carry no tier — they come from type resolution, not the call resolver.

#### `USES_TYPE` (added in schema 2.1)

`source_qualified` is a function; `target_qualified` is a Class, Interface or Enum this repo declares and whose name appears in the function's signature.

Types are a dependency a call graph cannot see: `checkout(o: Order)` calls nothing in `types.ts`, so before 2.1, changing `Order` reported a blast radius of zero while every function taking one broke. (The IMPORTS edges were there, but they are file-to-file while the blast radius seeds from symbols, so the two never met.)

Emitted conservatively — the name must resolve through the file's import map, or be declared beside it, and land on a type. Primitives, external types and parameter names resolve to nothing and produce no edge. The traversal weights these at **0.8**: naming a type is real evidence of dependency, but not proof that every change to it breaks the signature — widening a union or adding an optional field usually doesn't.

Graphs parsed before 2.1 simply lack these edges; type-only dependencies stay invisible to their blast radius until re-parsed.

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
  edge_kind: 'CALLS' | 'IMPORTS' | 'USES_TYPE' | 'INHERITS';
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

Each factor normalizes against its own cap — they are different units, and one
shared cap silently disables whichever it wasn't calibrated for:

```ts
interface RiskCaps {
  blast_functions: number;   // default 20 — where blast_radius saturates
  cyclomatic:      number;   // default 10 — decision points (McCabe's ceiling)
  lines_of_code:   number;   // default 50 — legacy fallback only
}
```

| Factor | Normalization |
|---|---|
| `blast_radius` | `log1p(n) / log1p(caps.blast_functions)`, capped at 1. Log rather than linear: the 0 → 1 caller jump is the one that decides a review; 40 vs 41 is not. Saturates at the cap. |
| `test_gaps` | Fraction of changed functions no test calls. See `TESTED_BY` below. |
| `complexity` | Cyclomatic against `caps.cyclomatic` when nodes carry `complexity`; lines-of-code against `caps.lines_of_code` otherwise. |
| `inheritance` | Share of changed symbols sitting in a class hierarchy, counting a method through its owning class. |

> **Changed in 0.3.0.** `caps.complexity` is gone, split into `caps.cyclomatic`
> and `caps.lines_of_code`. The Zod schema is `.strict()`, so a config carrying
> the old key errors instead of normalizing cyclomatic complexity against a
> lines-of-code figure. Scores from before 0.3.0 are not comparable — three of
> the four factors changed scale.

Weights override via `--risk-config <path>` (a JSON object). The shape is validated with Zod; unknown keys cause an error. Weights must sum to 1.0.

The score orders attention. It is not calibrated against defect data.

### `TESTED_BY` semantics

`source_qualified` is the tested entity, and its shape carries the evidence class:

| Shape | Meaning | Produced by |
|---|---|---|
| `src/a.ts::foo` | A test **calls** `foo`. Precise. | A resolved CALLS edge whose source file is a test file. |
| `src/a.ts` | Something in this file is probably covered. Coarse. | Filename matching — **only** for languages whose test calls don't resolve anywhere in the repo (rust, today). |

`target_qualified` is the test file. Note `file_path` on a TESTED_BY edge points
at the *test*, not the tested file.

Consumers must keep the two apart: flattening `a.ts::foo` to `a.ts` lets one
tested function vouch for every function beside it. Use
`GraphIndex.isTested(qualifiedName, filePath)`, which asks symbol evidence first
and falls back to the file-level signal.

> **Changed in 0.3.0.** `TESTED_BY` previously came from *imports* — any resolved
> import out of a test file marked the imported file, and every function in it,
> as tested. A test importing a single constant reported "0/3 untested" across
> three untested functions.

### `TestGap`

```ts
interface TestGap {
  function: string;       // qualified name
  file_path: string;
  line_start: number;
}
```

Changed functions no test exercises — the complement of `GraphIndex.isTested`.

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
  is_exported?: boolean;                      // see below
}

interface CallerRef {
  qualified_name: string;
  name: string;
  file_path: string;
  line: number;
  confidence: number;
  tier?: EdgeTier;                            // mirrors GraphEdge.tier
  alternatives?: string[];                    // mirrors GraphEdge.alternatives
}

interface CalleeRef {
  qualified_name: string;
  name: string;
  file_path: string;
  signature: string;
  confidence: number;
  tier?: EdgeTier;
}
```

**`is_exported` is load-bearing for reading `callers`.** For a non-exported
symbol the caller list is exhaustive, and an empty one means nothing calls it.
For an exported symbol it is a **lower bound** — the graph sees this repository
only, and a package consumer, a dynamic import or a downstream service is
invisible to it. "No callers" means "no callers here", not "unused".

**`confidence` / `tier` say how much of a claim an edge is.** The resolver grades
every CALLS edge from `receiver` (0.95, the receiver's type is known) down to
`ambiguous` (0.30, one of several candidates was picked); an edge at 0.60 was
reached by guessing that a name happened to be unique. Consumers that present
edges to a model should carry the tier through, or a guess and a typed resolution
arrive as the same assertion.

> **Changed in 0.3.0.** `CallerRef.tier`, `CalleeRef.confidence` / `tier` and
> `EnrichedFunction.is_exported` are new. `CalleeRef` previously carried no
> confidence at all, so a 0.30 callee reached consumers as flat fact.

`--format xml` surfaces all three as attributes:

```xml
<ChangedFunction name="AuthService.verifyToken" ... exported="true">
  <Callers count="1" untestedCount="1">
    <Caller name="..." file="tests/auth.test.ts" line="10" confidence="0.95" tier="receiver" />
  </Callers>
</ChangedFunction>
```

---

## Internal raw types

These are exported for library consumers but should be treated as **unstable**. They mirror the parser's intermediate representation before edge construction.

`RawFunction`, `RawClass`, `RawInterface`, `RawEnum`, `RawTest`, `RawImport`, `RawReExport`, `RawCallSite`, `RawCallEdge`, `ImportEdge`, `RawGraph`, `ParseBatchResult` — see `src/graph/types.ts:294–447`.

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

Current: **2.1**. 2.1 added the `USES_TYPE` edge kind — a function's signature naming a type this repo declares — so type-only dependencies show up in a blast radius; graphs parsed before 2.1 simply lack those edges. The `tier` field on `GraphEdge` was the 2.0 addition (an optional field; pre-2.0 graphs simply lack it).

The version is set in `src/shared/constants.ts:SCHEMA_VERSION` and stamped onto every `parse` / `update` output via `metadata.schema_version`. Loaders (`loadGraph`) call `enforceSchemaVersion` which:

- Rejects (exit 1) if the major doesn't match.
- Warns if the minor is older than the current parser's minor.
- Accepts silently if patch differs.

When changing the schema, bump both `SCHEMA_VERSION` and update this file.
