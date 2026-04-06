# Context V2 — Rich Structured Review Context

## Goal

Evolve the `kodus-graph context` command from a text-based output (`{ text, metadata }`) to a rich structured JSON output (`{ graph, analysis }`) that gives review agents everything they need per-function, while returning the updated graph for the orchestrator to persist.

## Context

The CLI is a **stateless engine** running inside an E2B sandbox. It receives graph JSON + repo files + changed files list, processes everything in-memory, and returns structured JSON. Storage (Postgres/SQLite/file) is the caller's concern.

The current `context` command already does parse + merge + basic analysis, but outputs a human-readable text blob that limits what review agents can extract. The building blocks for richer analysis already exist as independent modules (`diff.ts`, `flows.ts`, `blast-radius.ts`, `risk-score.ts`, `test-gaps.ts`).

## Command Interface

```
kodus-graph context \
  --files <paths...>       # changed files (required)
  --repo-dir <path>        # repository root (default: .)
  --graph <path>           # previous graph JSON (optional)
  --out <path>             # output JSON file (required)
  --min-confidence <n>     # CALLS edge threshold (default: 0.5)
  --max-depth <n>          # blast radius BFS depth (default: 3)
```

New flags: `--min-confidence`, `--max-depth`. All other flags unchanged.

**Breaking change:** Output format changes from `{ text, metadata }` to `{ graph, analysis }`. Acceptable at v0.1.0 with a single internal consumer.

## Output Schema

```typescript
interface ContextV2Output {
  // Merged graph — orchestrator persists this
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    metadata: ParseMetadata;
  };

  // Structured analysis — consumer builds agent prompts from this
  analysis: {
    changed_functions: EnrichedFunction[];
    structural_diff: DiffResult;
    blast_radius: BlastRadiusResult;
    affected_flows: AffectedFlow[];
    inheritance: InheritanceEntry[];
    test_gaps: TestGap[];
    risk: RiskScoreResult;
    metadata: ContextAnalysisMetadata;
  };
}
```

### EnrichedFunction — the core unit

Each changed function is self-contained. An agent looking at one item has callers, callees, test coverage, structural changes, and flow membership without cross-referencing other sections.

```typescript
interface EnrichedFunction {
  qualified_name: string;
  name: string;
  kind: NodeKind;
  signature: string;              // "validateToken(token: string) -> boolean"
  file_path: string;
  line_start: number;
  line_end: number;
  callers: CallerRef[];
  callees: CalleeRef[];
  has_test_coverage: boolean;
  diff_changes: string[];         // ["params", "return_type"] or [] if new
  is_new: boolean;                // true if not in previous graph
  in_flows: string[];             // entry point qualified_names that traverse this function
}

interface CallerRef {
  qualified_name: string;
  name: string;
  file_path: string;
  line: number;
  confidence: number;
}

interface CalleeRef {
  qualified_name: string;
  name: string;
  file_path: string;
  signature: string;
}
```

### AffectedFlow — flows that touch changed files

Not all flows — only those whose path includes a function in a changed file.

```typescript
interface AffectedFlow {
  entry_point: string;            // qualified_name of the entry
  type: "test" | "http";
  touches_changed: string[];      // which changed_functions are in the path
  depth: number;
  path: string[];
}
```

### InheritanceEntry — class hierarchy in changed files

Depth-1 only: immediate parents and children.

```typescript
interface InheritanceEntry {
  qualified_name: string;
  file_path: string;
  extends?: string;               // parent class qualified_name
  implements: string[];           // interface qualified_names
  children: string[];             // classes that extend this one
}
```

### ContextAnalysisMetadata

```typescript
interface ContextAnalysisMetadata {
  changed_functions_count: number;
  total_callers: number;
  total_callees: number;
  untested_count: number;
  affected_flows_count: number;
  duration_ms: number;
  min_confidence: number;
}
```

### Reused types (no changes)

- `DiffResult` from `analysis/diff.ts`
- `BlastRadiusResult` from `graph/types.ts`
- `RiskScoreResult` from `graph/types.ts`
- `TestGap` from `graph/types.ts`

## Internal Architecture

Four phases, composing existing modules:

### Phase 1: Parse & Merge

```
parseBatch(changedFiles, repoDir)  →  rawGraph
mergeGraphs(oldGraph, rawGraph)    →  mergedGraphData
indexGraph(mergedGraphData)        →  indexedGraph   (new helper in loader.ts)
```

If `--graph` is not provided, skip merge — use only parsed data.

To produce the `structural_diff`, we also need the old graph as an `IndexedGraph`. If `--graph` is provided, load it with `loadGraph()` before merging. If not provided, use an empty `IndexedGraph` (no nodes, no edges) so all parsed nodes appear as "added" in the diff.

**Note:** `loadGraph()` reads from a file path. A new `indexGraph(data: GraphData): IndexedGraph` function is needed in `graph/loader.ts` to build the same indices from in-memory data. `loadGraph()` becomes: read file → parse JSON → validate → `indexGraph()`.

### Phase 2: Independent analyses

All of these operate on the merged graph and can conceptually run in parallel (though in practice they're fast enough to run sequentially):

```
computeStructuralDiff(oldIndexed, newNodes, newEdges, changedFiles)  →  diff
computeBlastRadius(mergedGraphData, changedFiles, maxDepth)          →  blastRadius
detectFlows(indexedGraph, { maxDepth: 10, type: 'all' })             →  allFlows
findTestGaps(mergedGraphData, changedFiles)                          →  testGaps
computeRiskScore(mergedGraphData, changedFiles, blastRadius)         →  risk
extractInheritance(indexedGraph, changedFiles)                       →  inheritance
```

### Phase 3: Enrichment

For each non-test, non-Constructor function/method in changed files:

1. **callers** — from `indexedGraph.reverseAdjacency`, filtered by `min-confidence` on CALLS edges
2. **callees** — from `indexedGraph.adjacency`, CALLS edges
3. **has_test_coverage** — check TESTED_BY edges for the function's file (per-file granularity, matching existing behavior)
4. **diff_changes** — cross-reference with `diff.nodes.modified` by qualified_name. If in `diff.nodes.added`, mark `is_new: true`.
5. **signature** — build from `name + params + return_type`
6. **in_flows** — filter `allFlows` whose `path[]` includes this function's qualified_name

### Phase 4: Assembly

Assemble `ContextV2Output`:
- `graph`: merged nodes, edges, metadata
- `analysis`: all computed sections + enriched functions + metadata counters

Serialize to `--out` as JSON.

## New code

| File | What | ~Lines |
|------|------|--------|
| `src/analysis/context-builder.ts` | Orchestrates 4 phases, returns `ContextV2Output` | ~80 |
| `src/analysis/inheritance.ts` | `extractInheritance()` — reads INHERITS/IMPLEMENTS edges | ~30 |
| `src/analysis/enrich.ts` | `enrichChangedFunctions()` — Phase 3 cross-referencing | ~60 |
| `src/graph/types.ts` | New interfaces: `ContextV2Output`, `EnrichedFunction`, `AffectedFlow`, `InheritanceEntry`, `CallerRef`, `CalleeRef`, `ContextAnalysisMetadata` | ~50 |
| `src/graph/loader.ts` | Extract `indexGraph(data: GraphData): IndexedGraph` from `loadGraph()` | modify |
| `src/commands/context.ts` | Refactor to use `buildContextV2()` instead of `buildReviewContext()` | modify |

## Removed code

| File | Why |
|------|-----|
| `src/analysis/review-context.ts` | Replaced by `context-builder.ts` + `enrich.ts`. The text-based output is no longer needed. |

## Reused without changes

- `computeStructuralDiff()` from `analysis/diff.ts`
- `computeBlastRadius()` from `analysis/blast-radius.ts`
- `detectFlows()` from `analysis/flows.ts`
- `findTestGaps()` from `analysis/test-gaps.ts`
- `computeRiskScore()` from `analysis/risk-score.ts`
- `loadGraph()` from `graph/loader.ts`
- `parseBatch()` from `parser/batch.ts`
- `mergeGraphs()` from `graph/merger.ts`

## Behavior without `--graph`

| Section | Behavior |
|---------|----------|
| `graph` | Only the parsed changed files |
| `changed_functions` | All functions in changed files, enriched but no diff info |
| `structural_diff` | `summary: { added: N, removed: 0, modified: 0 }` — everything is "new" |
| `blast_radius` | Computed on partial graph only |
| `affected_flows` | Detected only within the parsed subgraph |
| `inheritance` | Only relationships visible in changed files |
| `test_gaps` | Works normally |
| `risk` | Computed with available data |

The output is useful but incomplete — the orchestrator knows a context without a base graph is "best effort".

## Testing strategy

- Unit tests for `extractInheritance()` and `enrichChangedFunctions()` with synthetic graph data
- Integration test for `buildContextV2()` — parse real files, verify output schema shape
- Verify backward-compatible: same `--files`, `--repo-dir`, `--graph`, `--out` flags work
- Verify `--min-confidence` filters callers correctly
- Verify `--max-depth` affects blast radius depth
- Verify without `--graph`: diff is empty, rest works
