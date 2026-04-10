# Blast Radius Evolution — Design Spec

**Date:** 2026-04-10
**Scope:** 5 evolutions to the blast radius analysis pipeline
**Approach:** Surgical modifications to existing modules (Approach A)
**Consumer:** Primary: AI code review agent (`--format prompt`). Secondary: JSON API.

---

## Overview

Evolve the blast radius system from a simple BFS with pass/fail confidence filtering to a confidence-weighted, contract-aware, flow-enriched impact analysis engine. Five changes, ordered by priority.

## Files Affected

| File | Changes |
|------|---------|
| `src/analysis/blast-radius.ts` | Confidence-weighted BFS, unidirectional IMPORTS, new adjacency structure |
| `src/analysis/risk-score.ts` | Bug fix: test gaps file_path mismatch |
| `src/analysis/enrich.ts` | Bug fix: same test gaps mismatch |
| `src/analysis/context-builder.ts` | Pass contract diffs and flows to blast radius |
| `src/analysis/prompt-formatter.ts` | Render new blast radius fields (confidence, category, flows) |
| `src/graph/types.ts` | New types: `BlastRadiusEntry`, `FlowRef`, evolved `BlastRadiusResult` |

---

## Change 1: Bug Fix — Test Gaps in Risk Score (P0)

### Problem

`risk-score.ts:20-21` builds a `Set` from `source_qualified` (e.g. `src/auth.ts::AuthService`) but filters using `n.file_path` (e.g. `src/auth.ts`). These are different formats — the filter never matches, so test gaps are always 100%.

Same bug exists in `enrich.ts:21` where `testedFiles` is built from `source_qualified` but compared against `node.file_path`.

### Fix

In both files, build the set from `e.file_path` instead of `e.source_qualified`:

**`risk-score.ts:20`:**
```typescript
// Before:
const testedFiles = new Set(graph.edges.filter(e => e.kind === 'TESTED_BY').map(e => e.source_qualified));
// After:
const testedFiles = new Set(graph.edges.filter(e => e.kind === 'TESTED_BY').map(e => e.file_path));
```

**`enrich.ts:21`:**
```typescript
// Before:
const testedFiles = new Set(graph.edges.filter(e => e.kind === 'TESTED_BY').map(e => e.source_qualified));
// After:
const testedFiles = new Set(graph.edges.filter(e => e.kind === 'TESTED_BY').map(e => e.file_path));
```

Rationale: `TESTED_BY` edges are created in `edges.ts` with `file_path` set to the source file being tested. Comparing `e.file_path` against `n.file_path` is the correct file-level semantic.

---

## Change 2: Unidirectional IMPORTS in Blast Radius (P1)

### Problem

`blast-radius.ts:22-25` adds IMPORTS edges bidirectionally. If `app.ts` imports `utils.ts`, a change to `app.ts` propagates to `utils.ts` — but `utils.ts` has no dependency on `app.ts`.

### Fix

Remove the forward direction. Keep only: change in imported module affects importers.

**`blast-radius.ts:22-25`:**
```typescript
// Before:
if (edge.kind === 'IMPORTS') {
    addEdge(edge.target_qualified, edge.source_qualified);
    addEdge(edge.source_qualified, edge.target_qualified);
}

// After:
if (edge.kind === 'IMPORTS') {
    // Unidirectional: change in target (imported) affects source (importer)
    addEdge(edge.target_qualified, edge.source_qualified);
}
```

Semantic: IMPORTS edge has `source_qualified` (the file that imports) and `target_qualified` (the module being imported). A change in `target` affects `source`, not the reverse.

---

## Change 3: Confidence-Weighted BFS (P1)

### New Types

```typescript
// src/graph/types.ts

interface BlastRadiusEntry {
    qualified_name: string;
    accumulated_confidence: number;  // product of confidences along the path
    edge_kind: 'CALLS' | 'IMPORTS'; // edge type that brought this node in
    impact_category: 'contract_breaking' | 'behavior_affected' | 'transitive';
    flows: FlowRef[];
    impact_score: number;
}

interface FlowRef {
    entry_point: string;
    type: 'test' | 'http';
    criticality: number;
}

interface BlastRadiusResult {
    total_functions: number;
    total_files: number;
    by_depth: Record<string, BlastRadiusEntry[]>;
}
```

### Algorithm

The adjacency list stores tuples instead of plain strings:

```typescript
interface AdjEntry {
    neighbor: string;
    confidence: number;  // edge confidence (1.0 for IMPORTS)
    edgeKind: 'CALLS' | 'IMPORTS';
}
```

BFS carries `accumulated_confidence` through the frontier:

```typescript
interface FrontierEntry {
    qualified: string;
    accumulated: number;
}
```

Propagation rules:
- CALLS edge: `child_accumulated = parent_accumulated × edge.confidence`
- IMPORTS edge: `child_accumulated = parent_accumulated × 1.0` (deterministic)
- If a node is reached by multiple paths, keep the **highest** accumulated (most confident path)
- `minConfidence` threshold still filters individual edges at adjacency-build time (unchanged behavior)

### Example

```
A altered (seed, accumulated = 1.0)
  -> B calls A (conf 0.95) -> B.accumulated = 0.95
    -> C calls B (conf 0.70) -> C.accumulated = 0.665
      -> D calls C (conf 0.50) -> D.accumulated = 0.33
```

---

## Change 4: Contract-Aware Blast Radius (P2)

### Impact Categories

Each `BlastRadiusEntry` is classified into one of three categories:

| Category | Meaning | When |
|----------|---------|------|
| `contract_breaking` | Callers may need code changes | Depth 1 callers of a seed that has contract_diffs (params or return_type changed) |
| `behavior_affected` | Behavior may have changed, verify | Depth 1 callers of a seed with only body changes, OR nodes reached via IMPORTS |
| `transitive` | Indirect impact, awareness | Depth > 1 (any edge type) |

### Implementation

`computeBlastRadius` receives a new optional parameter:

```typescript
function computeBlastRadius(
    graph: GraphData,
    changedQualifiedNames: string[],
    maxDepth?: number,
    minConfidence?: number,
    contractBreakingSeeds?: Set<string>,
): BlastRadiusResult
```

The `context-builder.ts` builds `contractBreakingSeeds` from `structuralDiff`:

```typescript
const contractBreakingSeeds = new Set(
    structuralDiff.nodes.modified
        .filter(m => m.contract_diffs.length > 0)
        .map(m => m.qualified_name)
);
```

Classification logic during BFS — each frontier entry tracks which seed originated it:

```typescript
interface FrontierEntry {
    qualified: string;
    accumulated: number;
    originSeed: string;   // the changed qualified_name that started this path
    edgeKind: 'CALLS' | 'IMPORTS';
    depth: number;
}
```

Rules:
- Depth 1, `originSeed` is in `contractBreakingSeeds`, edge is CALLS: `contract_breaking`
- Depth 1, `originSeed` is NOT in `contractBreakingSeeds`, edge is CALLS: `behavior_affected`
- Depth 1, edge is IMPORTS: `behavior_affected`
- Depth > 1 (any edge type): `transitive`

---

## Change 5: Flow-Weighted Blast Radius (P2)

### Flow Enrichment

After `computeBlastRadius` and `detectFlows` both complete, a new function enriches blast radius entries with flow data:

```typescript
function enrichBlastRadiusWithFlows(
    blastRadius: BlastRadiusResult,
    allFlows: FlowsResult,
): BlastRadiusResult
```

This function:
1. Builds a flow index: `Map<qualified_name, FlowRef[]>` from all flow paths
2. For each `BlastRadiusEntry`, sets `flows` from the index
3. Computes `impact_score`

### Impact Score Formula

```
impact_score = accumulated_confidence × flow_weight

flow_weight calculation:
  - Has HTTP flow: max(http_flow_criticalities) / max_criticality_global
  - Has only test flow: 0.3 × max(test_flow_criticalities) / max_criticality_global
  - No flows: 0.1 (baseline)

Result normalized to 0.0-1.0
```

HTTP flows weigh more than test flows because they represent production execution paths.

### Ordering

Within each depth level, entries are sorted by `impact_score` descending. The prompt-formatter shows highest-impact functions first. If truncation is needed (`maxPromptChars`), lower-impact entries are cut.

---

## Prompt Format Evolution

### Before

```
BLAST RADIUS:
  depth 1: authenticate, validateSession (2)
  depth 2: loginHandler, refreshToken (2)
```

### After

```
BLAST RADIUS:
  depth 1 [contract_breaking]: authenticate (95%, score 0.92)
    flows: HTTP POST /login, HTTP POST /refresh
    ⚠ params changed — callers may need update
  depth 1 [behavior_affected]: hashPassword (85%, score 0.31)
    flows: TEST test_auth
  depth 2 [transitive]: loginHandler (67%, score 0.67)
    flows: HTTP POST /login
```

The `impact_category` label gives the agent immediate actionability:
- `contract_breaking`: must verify callers
- `behavior_affected`: verify expected semantics
- `transitive`: awareness, lower priority

---

## JSON Output Evolution

The `ContextV2Output.analysis.blast_radius` field evolves from:

```json
{
  "total_functions": 5,
  "total_files": 3,
  "by_depth": {
    "1": ["src/auth.ts::authenticate", "src/auth.ts::validateSession"],
    "2": ["src/api/login.ts::loginHandler"]
  }
}
```

To:

```json
{
  "total_functions": 5,
  "total_files": 3,
  "by_depth": {
    "1": [
      {
        "qualified_name": "src/auth.ts::authenticate",
        "accumulated_confidence": 0.95,
        "edge_kind": "CALLS",
        "impact_category": "contract_breaking",
        "flows": [
          { "entry_point": "src/api/login.ts::post", "type": "http", "criticality": 450 }
        ],
        "impact_score": 0.92
      }
    ],
    "2": [
      {
        "qualified_name": "src/api/login.ts::loginHandler",
        "accumulated_confidence": 0.67,
        "edge_kind": "CALLS",
        "impact_category": "transitive",
        "flows": [
          { "entry_point": "src/api/login.ts::post", "type": "http", "criticality": 450 }
        ],
        "impact_score": 0.67
      }
    ]
  }
}
```

---

## Implementation Order

1. **Types** (`types.ts`) — add `BlastRadiusEntry`, `FlowRef`, update `BlastRadiusResult`
2. **Bug fix** (`risk-score.ts`, `enrich.ts`) — 1-line fix each
3. **IMPORTS unidirectional** (`blast-radius.ts`) — remove 1 line
4. **Confidence-weighted BFS** (`blast-radius.ts`) — rewrite adjacency + BFS loop
5. **Contract-aware categories** (`blast-radius.ts`, `context-builder.ts`) — add `contractBreakingSeeds` param + classification logic
6. **Flow enrichment** (`context-builder.ts`) — new `enrichBlastRadiusWithFlows` function after BFS
7. **Prompt formatter** (`prompt-formatter.ts`) — render new fields in BLAST RADIUS section
8. **Tests** — update existing + add new for confidence propagation, categories, flow enrichment
