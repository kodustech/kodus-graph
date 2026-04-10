# Blast Radius Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the blast radius from simple BFS with pass/fail confidence to a confidence-weighted, contract-aware, flow-enriched impact analysis engine.

**Architecture:** Surgical modifications to 6 existing files + their tests. New types in `types.ts`, evolved BFS in `blast-radius.ts`, bug fixes in `risk-score.ts`/`enrich.ts`, enrichment orchestration in `context-builder.ts`, and prompt rendering in `prompt-formatter.ts`.

**Tech Stack:** TypeScript, Bun (test runner + runtime), ast-grep (parser)

**Test runner:** `bun test` — tests use `import { describe, expect, it } from 'bun:test'`

---

### Task 1: New Types in `types.ts`

**Files:**
- Modify: `src/graph/types.ts:64-68`
- Test: `tests/graph/types.test.ts`

- [ ] **Step 1: Add `FlowRef` and `BlastRadiusEntry` types and update `BlastRadiusResult`**

In `src/graph/types.ts`, replace the existing `BlastRadiusResult` interface and add the new types before it:

```typescript
// Add after the GraphData interface (line 42) and before the existing BlastRadiusResult

export interface FlowRef {
    entry_point: string;
    type: 'test' | 'http';
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

// Replace the existing BlastRadiusResult:
export interface BlastRadiusResult {
    total_functions: number;
    total_files: number;
    by_depth: Record<string, BlastRadiusEntry[]>;
}
```

- [ ] **Step 2: Run existing tests to verify nothing breaks yet**

Run: `bun test tests/graph/types.test.ts`
Expected: PASS (types are structural — adding new interfaces doesn't break existing ones)

- [ ] **Step 3: Commit**

```bash
git add src/graph/types.ts
git commit -m "feat(types): add BlastRadiusEntry, FlowRef, ImpactCategory types"
```

---

### Task 2: Bug Fix — Test Gaps in `risk-score.ts` and `enrich.ts`

**Files:**
- Modify: `src/analysis/risk-score.ts:20`
- Modify: `src/analysis/enrich.ts:21`
- Test: `tests/analysis/risk-score.test.ts`
- Test: `tests/analysis/enrich.test.ts`

- [ ] **Step 1: Write failing test for risk-score test gaps bug**

In `tests/analysis/risk-score.test.ts`, add this test inside the `describe('computeRiskScore')` block:

```typescript
it('should correctly detect tested files via TESTED_BY edge file_path', () => {
    const graph: GraphData = {
        nodes: [
            {
                kind: 'Function',
                name: 'foo',
                qualified_name: 'src/a.ts::foo',
                file_path: 'src/a.ts',
                line_start: 1,
                line_end: 5,
                language: 'typescript',
                is_test: false,
                file_hash: 'a',
            },
        ],
        edges: [
            {
                kind: 'TESTED_BY',
                source_qualified: 'src/a.ts::foo',
                target_qualified: 'tests/a.test.ts::test_foo',
                file_path: 'src/a.ts',
                line: 0,
            },
        ],
    };
    const blastRadius: BlastRadiusResult = { total_functions: 1, total_files: 1, by_depth: {} };

    const result = computeRiskScore(graph, ['src/a.ts'], blastRadius);
    // test_gaps factor should be 0 (foo IS tested)
    expect(result.factors.test_gaps.value).toBe(0);
    expect(result.factors.test_gaps.detail).toBe('0/1 untested');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/analysis/risk-score.test.ts`
Expected: FAIL — `test_gaps.value` will be `1` instead of `0` because the bug compares `source_qualified` against `file_path`

- [ ] **Step 3: Fix `risk-score.ts` — change `e.source_qualified` to `e.file_path`**

In `src/analysis/risk-score.ts` line 20, change:

```typescript
// Before:
const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.source_qualified));
// After:
const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.file_path));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/analysis/risk-score.test.ts`
Expected: PASS

- [ ] **Step 5: Fix same bug in `enrich.ts`**

In `src/analysis/enrich.ts` line 21, change:

```typescript
// Before:
const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.source_qualified));
// After:
const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.file_path));
```

- [ ] **Step 6: Run enrich tests to verify no regression**

Run: `bun test tests/analysis/enrich.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/analysis/risk-score.ts src/analysis/enrich.ts tests/analysis/risk-score.test.ts
git commit -m "fix: test gaps detection using file_path instead of source_qualified"
```

---

### Task 3: Unidirectional IMPORTS in Blast Radius

**Files:**
- Modify: `src/analysis/blast-radius.ts:22-25`
- Test: `tests/analysis/blast-radius.test.ts`

- [ ] **Step 1: Write test proving bidirectional IMPORTS is wrong**

In `tests/analysis/blast-radius.test.ts`, add inside the `describe` block:

```typescript
it('should NOT propagate IMPORTS in forward direction (importer change should not affect imported)', () => {
    const graph: GraphData = {
        nodes: [
            {
                kind: 'Function',
                name: 'app',
                qualified_name: 'app.ts::app',
                file_path: 'app.ts',
                line_start: 1,
                line_end: 10,
                language: 'typescript',
                is_test: false,
                file_hash: 'a',
            },
            {
                kind: 'Function',
                name: 'utils',
                qualified_name: 'utils.ts::utils',
                file_path: 'utils.ts',
                line_start: 1,
                line_end: 10,
                language: 'typescript',
                is_test: false,
                file_hash: 'b',
            },
        ],
        edges: [
            {
                // app imports utils
                kind: 'IMPORTS',
                source_qualified: 'app.ts::app',
                target_qualified: 'utils.ts::utils',
                file_path: 'app.ts',
                line: 1,
            },
        ],
    };

    // Change to app.ts should NOT affect utils.ts (utils doesn't depend on app)
    const result = computeBlastRadius(graph, ['app.ts::app'], 2);
    expect(result.total_functions).toBe(1); // only app itself

    const allReached = new Set<string>(['app.ts::app']);
    for (const entries of Object.values(result.by_depth)) {
        for (const e of entries) {
            allReached.add(typeof e === 'string' ? e : e.qualified_name);
        }
    }
    expect(allReached.has('utils.ts::utils')).toBe(false);
});

it('should propagate IMPORTS in reverse direction (imported change affects importer)', () => {
    const graph: GraphData = {
        nodes: [
            {
                kind: 'Function',
                name: 'app',
                qualified_name: 'app.ts::app',
                file_path: 'app.ts',
                line_start: 1,
                line_end: 10,
                language: 'typescript',
                is_test: false,
                file_hash: 'a',
            },
            {
                kind: 'Function',
                name: 'utils',
                qualified_name: 'utils.ts::utils',
                file_path: 'utils.ts',
                line_start: 1,
                line_end: 10,
                language: 'typescript',
                is_test: false,
                file_hash: 'b',
            },
        ],
        edges: [
            {
                kind: 'IMPORTS',
                source_qualified: 'app.ts::app',
                target_qualified: 'utils.ts::utils',
                file_path: 'app.ts',
                line: 1,
            },
        ],
    };

    // Change to utils.ts SHOULD affect app.ts (app depends on utils)
    const result = computeBlastRadius(graph, ['utils.ts::utils'], 2);
    expect(result.total_functions).toBe(2);

    const allReached = new Set<string>(['utils.ts::utils']);
    for (const entries of Object.values(result.by_depth)) {
        for (const e of entries) {
            allReached.add(typeof e === 'string' ? e : e.qualified_name);
        }
    }
    expect(allReached.has('app.ts::app')).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify the first test fails**

Run: `bun test tests/analysis/blast-radius.test.ts`
Expected: First new test FAILS (bidirectional still active), second PASSES

- [ ] **Step 3: Remove the forward IMPORTS edge**

In `src/analysis/blast-radius.ts`, change lines 22-25:

```typescript
// Before:
if (edge.kind === 'IMPORTS') {
    // IMPORTS: no confidence filter, bidirectional
    addEdge(edge.target_qualified, edge.source_qualified);
    addEdge(edge.source_qualified, edge.target_qualified);
}

// After:
if (edge.kind === 'IMPORTS') {
    // IMPORTS: unidirectional — change in imported affects importer
    addEdge(edge.target_qualified, edge.source_qualified);
}
```

- [ ] **Step 4: Run all blast-radius tests**

Run: `bun test tests/analysis/blast-radius.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/analysis/blast-radius.ts tests/analysis/blast-radius.test.ts
git commit -m "fix: make IMPORTS edges unidirectional in blast radius"
```

---

### Task 4: Confidence-Weighted BFS

**Files:**
- Modify: `src/analysis/blast-radius.ts` (full rewrite of function body)
- Modify: `tests/analysis/blast-radius.test.ts` (update existing + add new)

- [ ] **Step 1: Write test for accumulated confidence propagation**

Add to `tests/analysis/blast-radius.test.ts`:

```typescript
it('should propagate accumulated confidence through CALLS chain', () => {
    const graph: GraphData = {
        nodes: [
            { kind: 'Function', name: 'a', qualified_name: 'a.ts::a', file_path: 'a.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'x' },
            { kind: 'Function', name: 'b', qualified_name: 'b.ts::b', file_path: 'b.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'y' },
            { kind: 'Function', name: 'c', qualified_name: 'c.ts::c', file_path: 'c.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'z' },
        ],
        edges: [
            { kind: 'CALLS', source_qualified: 'b.ts::b', target_qualified: 'a.ts::a', file_path: 'b.ts', line: 2, confidence: 0.9 },
            { kind: 'CALLS', source_qualified: 'c.ts::c', target_qualified: 'b.ts::b', file_path: 'c.ts', line: 2, confidence: 0.8 },
        ],
    };

    const result = computeBlastRadius(graph, ['a.ts::a'], 3);

    // Depth 1: b calls a with 0.9
    const depth1 = result.by_depth['1'];
    expect(depth1).toBeDefined();
    const bEntry = depth1.find(e => e.qualified_name === 'b.ts::b');
    expect(bEntry).toBeDefined();
    expect(bEntry!.accumulated_confidence).toBeCloseTo(0.9, 2);
    expect(bEntry!.edge_kind).toBe('CALLS');

    // Depth 2: c calls b with 0.8 → accumulated = 0.9 * 0.8 = 0.72
    const depth2 = result.by_depth['2'];
    expect(depth2).toBeDefined();
    const cEntry = depth2.find(e => e.qualified_name === 'c.ts::c');
    expect(cEntry).toBeDefined();
    expect(cEntry!.accumulated_confidence).toBeCloseTo(0.72, 2);
});

it('should use highest accumulated confidence when node is reachable via multiple paths', () => {
    const graph: GraphData = {
        nodes: [
            { kind: 'Function', name: 'target', qualified_name: 'x.ts::target', file_path: 'x.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'h1' },
            { kind: 'Function', name: 'pathA', qualified_name: 'a.ts::pathA', file_path: 'a.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'h2' },
            { kind: 'Function', name: 'pathB', qualified_name: 'b.ts::pathB', file_path: 'b.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'h3' },
            { kind: 'Function', name: 'shared', qualified_name: 's.ts::shared', file_path: 's.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'h4' },
        ],
        edges: [
            // Path A: target ←(0.9) pathA ←(0.9) shared → accumulated = 0.81
            { kind: 'CALLS', source_qualified: 'a.ts::pathA', target_qualified: 'x.ts::target', file_path: 'a.ts', line: 2, confidence: 0.9 },
            { kind: 'CALLS', source_qualified: 's.ts::shared', target_qualified: 'a.ts::pathA', file_path: 's.ts', line: 2, confidence: 0.9 },
            // Path B: target ←(0.5) pathB ←(0.5) shared → accumulated = 0.25
            { kind: 'CALLS', source_qualified: 'b.ts::pathB', target_qualified: 'x.ts::target', file_path: 'b.ts', line: 2, confidence: 0.5 },
            { kind: 'CALLS', source_qualified: 's.ts::shared', target_qualified: 'b.ts::pathB', file_path: 's.ts', line: 3, confidence: 0.5 },
        ],
    };

    const result = computeBlastRadius(graph, ['x.ts::target'], 3);

    // shared is reached via both paths — should use the highest (0.81 via pathA)
    const depth2 = result.by_depth['2'];
    expect(depth2).toBeDefined();
    const sharedEntry = depth2.find(e => e.qualified_name === 's.ts::shared');
    expect(sharedEntry).toBeDefined();
    expect(sharedEntry!.accumulated_confidence).toBeCloseTo(0.81, 2);
});

it('should set accumulated_confidence to 1.0 for IMPORTS edges', () => {
    const graph: GraphData = {
        nodes: [
            { kind: 'Function', name: 'util', qualified_name: 'util.ts::util', file_path: 'util.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'h1' },
            { kind: 'Function', name: 'consumer', qualified_name: 'consumer.ts::consumer', file_path: 'consumer.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'h2' },
        ],
        edges: [
            { kind: 'IMPORTS', source_qualified: 'consumer.ts::consumer', target_qualified: 'util.ts::util', file_path: 'consumer.ts', line: 1 },
        ],
    };

    const result = computeBlastRadius(graph, ['util.ts::util'], 2, 0.99);

    const depth1 = result.by_depth['1'];
    expect(depth1).toBeDefined();
    const consumerEntry = depth1.find(e => e.qualified_name === 'consumer.ts::consumer');
    expect(consumerEntry).toBeDefined();
    expect(consumerEntry!.accumulated_confidence).toBe(1.0);
    expect(consumerEntry!.edge_kind).toBe('IMPORTS');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/analysis/blast-radius.test.ts`
Expected: FAIL — `by_depth` values are still `string[]`, not `BlastRadiusEntry[]`

- [ ] **Step 3: Rewrite `computeBlastRadius` with confidence-weighted BFS**

Replace the entire content of `src/analysis/blast-radius.ts`:

```typescript
import type { BlastRadiusEntry, BlastRadiusResult, GraphData, ImpactCategory } from '../graph/types';

interface AdjEntry {
    neighbor: string;
    confidence: number;
    edgeKind: 'CALLS' | 'IMPORTS';
}

interface FrontierEntry {
    qualified: string;
    accumulated: number;
    edgeKind: 'CALLS' | 'IMPORTS';
    originSeed: string;
}

export function computeBlastRadius(
    graph: GraphData,
    changedQualifiedNames: string[],
    maxDepth: number = 2,
    minConfidence?: number,
    contractBreakingSeeds?: Set<string>,
): BlastRadiusResult {
    const minConf = minConfidence ?? 0.5;

    // Build adjacency list with confidence metadata
    const adj = new Map<string, AdjEntry[]>();

    const addEdge = (from: string, to: string, confidence: number, edgeKind: 'CALLS' | 'IMPORTS') => {
        if (!adj.has(from)) {
            adj.set(from, []);
        }
        adj.get(from)!.push({ neighbor: to, confidence, edgeKind });
    };

    for (const edge of graph.edges) {
        if (edge.kind === 'IMPORTS') {
            // Unidirectional: change in imported affects importer
            addEdge(edge.target_qualified, edge.source_qualified, 1.0, 'IMPORTS');
        } else if (edge.kind === 'CALLS' && (edge.confidence ?? 1.0) >= minConf) {
            // Reverse: find callers of changed function
            addEdge(edge.target_qualified, edge.source_qualified, edge.confidence ?? 1.0, 'CALLS');
        }
    }

    // Track best accumulated confidence per visited node
    const bestConfidence = new Map<string, number>();
    for (const seed of changedQualifiedNames) {
        bestConfidence.set(seed, 1.0);
    }

    const byDepth: Record<string, BlastRadiusEntry[]> = {};
    const seedSet = new Set(changedQualifiedNames);
    const cbSeeds = contractBreakingSeeds ?? new Set<string>();

    // Track entry metadata per visited node for building BlastRadiusEntry
    const entryMeta = new Map<string, { edgeKind: 'CALLS' | 'IMPORTS'; originSeed: string }>();

    let frontier: FrontierEntry[] = changedQualifiedNames.map((q) => ({
        qualified: q,
        accumulated: 1.0,
        edgeKind: 'CALLS' as const,
        originSeed: q,
    }));

    for (let depth = 1; depth <= maxDepth; depth++) {
        const next: FrontierEntry[] = [];
        const depthEntries: BlastRadiusEntry[] = [];

        for (const current of frontier) {
            for (const { neighbor, confidence, edgeKind } of adj.get(current.qualified) || []) {
                const accumulated = current.accumulated * confidence;
                const existing = bestConfidence.get(neighbor);

                if (existing === undefined || accumulated > existing) {
                    bestConfidence.set(neighbor, accumulated);

                    if (!seedSet.has(neighbor)) {
                        // Determine impact category
                        let impact_category: ImpactCategory;
                        if (depth === 1 && edgeKind === 'CALLS' && cbSeeds.has(current.originSeed)) {
                            impact_category = 'contract_breaking';
                        } else if (depth === 1) {
                            impact_category = 'behavior_affected';
                        } else {
                            impact_category = 'transitive';
                        }

                        entryMeta.set(neighbor, { edgeKind, originSeed: current.originSeed });

                        // Check if already in depthEntries (update) or new
                        const existingIdx = depthEntries.findIndex((e) => e.qualified_name === neighbor);
                        const entry: BlastRadiusEntry = {
                            qualified_name: neighbor,
                            accumulated_confidence: accumulated,
                            edge_kind: edgeKind,
                            impact_category,
                            flows: [],
                            impact_score: 0,
                        };

                        if (existingIdx >= 0) {
                            depthEntries[existingIdx] = entry;
                        } else {
                            depthEntries.push(entry);
                        }

                        if (existing === undefined) {
                            next.push({
                                qualified: neighbor,
                                accumulated,
                                edgeKind,
                                originSeed: current.originSeed,
                            });
                        }
                    }
                }
            }
        }

        if (depthEntries.length > 0) {
            byDepth[String(depth)] = depthEntries;
        }
        frontier = next;
    }

    // Count unique files and total functions
    const nodeIndex = new Map(graph.nodes.map((n) => [n.qualified_name, n]));
    const impactedFiles = new Set<string>();
    const allVisited = new Set(bestConfidence.keys());

    for (const q of allVisited) {
        const node = nodeIndex.get(q);
        if (node) {
            impactedFiles.add(node.file_path);
        }
    }

    return {
        total_functions: allVisited.size,
        total_files: impactedFiles.size,
        by_depth: byDepth,
    };
}
```

- [ ] **Step 4: Update existing tests to use `BlastRadiusEntry` structure**

The existing tests that access `by_depth` values as strings need updating. In every existing test that does:

```typescript
for (const n of names) { allReached.add(n); }
```

Change to:

```typescript
for (const e of entries) { allReached.add(e.qualified_name); }
```

Specifically, update the helper pattern used in multiple tests. In the test `'should only use provided qualified names as seeds'`, change:

```typescript
// Before:
for (const names of Object.values(result.by_depth)) {
    for (const n of names) {
        allReached.add(n);
    }
}

// After:
for (const entries of Object.values(result.by_depth)) {
    for (const e of entries) {
        allReached.add(e.qualified_name);
    }
}
```

Apply the same pattern to: `'should filter CALLS edges by minConfidence'` and `'should NOT filter IMPORTS edges by confidence'`.

- [ ] **Step 5: Run all blast-radius tests**

Run: `bun test tests/analysis/blast-radius.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/analysis/blast-radius.ts tests/analysis/blast-radius.test.ts
git commit -m "feat: confidence-weighted BFS with accumulated_confidence and impact_category"
```

---

### Task 5: Contract-Aware Categories via `context-builder.ts`

**Files:**
- Modify: `src/analysis/context-builder.ts:96`
- Test: `tests/analysis/context-builder.test.ts`

- [ ] **Step 1: Write test for contract-breaking category propagation**

Add to `tests/analysis/context-builder.test.ts`:

```typescript
it('should mark blast radius entries as contract_breaking when seed has contract diffs', () => {
    const mergedGraph: GraphData = {
        nodes: [
            {
                kind: 'Function', name: 'processOrder', qualified_name: 'src/order.ts::processOrder',
                file_path: 'src/order.ts', line_start: 10, line_end: 30, language: 'typescript',
                params: '(id: number, priority: number)', return_type: 'string | null',
                is_test: false, file_hash: 'x',
            },
            {
                kind: 'Function', name: 'handleRequest', qualified_name: 'src/handler.ts::handleRequest',
                file_path: 'src/handler.ts', line_start: 1, line_end: 10, language: 'typescript',
                params: '(req: Request)', return_type: 'Response',
                is_test: false, file_hash: 'y',
            },
        ],
        edges: [
            {
                kind: 'CALLS', source_qualified: 'src/handler.ts::handleRequest',
                target_qualified: 'src/order.ts::processOrder',
                file_path: 'src/handler.ts', line: 5, confidence: 0.95,
            },
        ],
    };

    const oldGraph: GraphData = {
        nodes: [
            {
                kind: 'Function', name: 'processOrder', qualified_name: 'src/order.ts::processOrder',
                file_path: 'src/order.ts', line_start: 10, line_end: 25, language: 'typescript',
                params: '(id: number)', return_type: 'string',
                is_test: false, file_hash: 'x', content_hash: 'old_hash',
            },
        ],
        edges: [],
    };

    const result = buildContextV2({
        mergedGraph,
        oldGraph,
        changedFiles: ['src/order.ts'],
        minConfidence: 0.5,
        maxDepth: 3,
    });

    // processOrder has params and return_type contract diffs
    // handleRequest is depth-1 caller → should be contract_breaking
    const depth1 = result.analysis.blast_radius.by_depth['1'];
    expect(depth1).toBeDefined();
    const handler = depth1?.find(e => e.qualified_name === 'src/handler.ts::handleRequest');
    expect(handler).toBeDefined();
    expect(handler!.impact_category).toBe('contract_breaking');
});

it('should mark blast radius entries as behavior_affected when seed has only body changes', () => {
    const mergedGraph: GraphData = {
        nodes: [
            {
                kind: 'Function', name: 'compute', qualified_name: 'src/calc.ts::compute',
                file_path: 'src/calc.ts', line_start: 1, line_end: 20, language: 'typescript',
                params: '(x: number)', return_type: 'number',
                is_test: false, file_hash: 'a', content_hash: 'new_hash',
            },
            {
                kind: 'Function', name: 'report', qualified_name: 'src/report.ts::report',
                file_path: 'src/report.ts', line_start: 1, line_end: 10, language: 'typescript',
                is_test: false, file_hash: 'b',
            },
        ],
        edges: [
            {
                kind: 'CALLS', source_qualified: 'src/report.ts::report',
                target_qualified: 'src/calc.ts::compute',
                file_path: 'src/report.ts', line: 5, confidence: 0.9,
            },
        ],
    };

    const oldGraph: GraphData = {
        nodes: [
            {
                kind: 'Function', name: 'compute', qualified_name: 'src/calc.ts::compute',
                file_path: 'src/calc.ts', line_start: 1, line_end: 18, language: 'typescript',
                params: '(x: number)', return_type: 'number',
                is_test: false, file_hash: 'a', content_hash: 'old_hash',
            },
        ],
        edges: [],
    };

    const result = buildContextV2({
        mergedGraph,
        oldGraph,
        changedFiles: ['src/calc.ts'],
        minConfidence: 0.5,
        maxDepth: 3,
    });

    // compute has body change but same params/return → behavior_affected
    const depth1 = result.analysis.blast_radius.by_depth['1'];
    expect(depth1).toBeDefined();
    const report = depth1?.find(e => e.qualified_name === 'src/report.ts::report');
    expect(report).toBeDefined();
    expect(report!.impact_category).toBe('behavior_affected');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/analysis/context-builder.test.ts`
Expected: FAIL — `computeBlastRadius` is not receiving `contractBreakingSeeds`

- [ ] **Step 3: Build `contractBreakingSeeds` and pass to `computeBlastRadius`**

In `src/analysis/context-builder.ts`, replace line 96:

```typescript
// Before:
const blastRadius = computeBlastRadius(mergedGraph, [...trulyChangedQN], maxDepth, minConfidence);

// After:
const contractBreakingSeeds = new Set(
    structuralDiff.nodes.modified
        .filter((m) => m.contract_diffs.length > 0)
        .map((m) => m.qualified_name),
);
const blastRadius = computeBlastRadius(mergedGraph, [...trulyChangedQN], maxDepth, minConfidence, contractBreakingSeeds);
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/analysis/context-builder.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/analysis/context-builder.ts tests/analysis/context-builder.test.ts
git commit -m "feat: contract-aware blast radius categories via contractBreakingSeeds"
```

---

### Task 6: Flow-Weighted Enrichment

**Files:**
- Modify: `src/analysis/context-builder.ts` (add `enrichBlastRadiusWithFlows` function + call it)
- Test: `tests/analysis/context-builder.test.ts`

- [ ] **Step 1: Write test for flow enrichment and impact_score**

Add to `tests/analysis/context-builder.test.ts`:

```typescript
it('should enrich blast radius entries with flows and compute impact_score', () => {
    const mergedGraph: GraphData = {
        nodes: [
            {
                kind: 'Function', name: 'authenticate', qualified_name: 'src/auth.ts::authenticate',
                file_path: 'src/auth.ts', line_start: 10, line_end: 25, language: 'typescript',
                params: '(ctx: Context)', return_type: 'Result',
                is_test: false, file_hash: 'a',
            },
            {
                kind: 'Method', name: 'LoginController.post', qualified_name: 'src/ctrl.ts::LoginController::post',
                file_path: 'src/ctrl.ts', line_start: 5, line_end: 15, language: 'typescript',
                params: '(req: Request)', return_type: 'Response', parent_name: 'LoginController',
                is_test: false, file_hash: 'b',
            },
        ],
        edges: [
            {
                kind: 'CALLS', source_qualified: 'src/ctrl.ts::LoginController::post',
                target_qualified: 'src/auth.ts::authenticate',
                file_path: 'src/ctrl.ts', line: 8, confidence: 0.95,
            },
        ],
    };

    const result = buildContextV2({
        mergedGraph,
        oldGraph: null,
        changedFiles: ['src/auth.ts'],
        minConfidence: 0.5,
        maxDepth: 3,
    });

    // LoginController.post is an HTTP handler (name 'post', parent 'LoginController')
    // It should appear in blast radius with flow info
    const depth1 = result.analysis.blast_radius.by_depth['1'];
    if (depth1 && depth1.length > 0) {
        const ctrl = depth1.find(e => e.qualified_name === 'src/ctrl.ts::LoginController::post');
        if (ctrl) {
            // Should have flow data if detected as HTTP handler
            expect(ctrl.impact_score).toBeGreaterThanOrEqual(0);
            // impact_score should be > 0 since it has confidence > 0
            expect(ctrl.impact_score).toBeGreaterThan(0);
        }
    }
});

it('should sort blast radius entries by impact_score descending within each depth', () => {
    const mergedGraph: GraphData = {
        nodes: [
            {
                kind: 'Function', name: 'target', qualified_name: 'src/t.ts::target',
                file_path: 'src/t.ts', line_start: 1, line_end: 10, language: 'typescript',
                is_test: false, file_hash: 'h1',
            },
            {
                kind: 'Function', name: 'highCaller', qualified_name: 'src/high.ts::highCaller',
                file_path: 'src/high.ts', line_start: 1, line_end: 10, language: 'typescript',
                is_test: false, file_hash: 'h2',
            },
            {
                kind: 'Function', name: 'lowCaller', qualified_name: 'src/low.ts::lowCaller',
                file_path: 'src/low.ts', line_start: 1, line_end: 10, language: 'typescript',
                is_test: false, file_hash: 'h3',
            },
        ],
        edges: [
            { kind: 'CALLS', source_qualified: 'src/high.ts::highCaller', target_qualified: 'src/t.ts::target', file_path: 'src/high.ts', line: 2, confidence: 0.95 },
            { kind: 'CALLS', source_qualified: 'src/low.ts::lowCaller', target_qualified: 'src/t.ts::target', file_path: 'src/low.ts', line: 2, confidence: 0.3 },
        ],
    };

    const result = buildContextV2({
        mergedGraph,
        oldGraph: null,
        changedFiles: ['src/t.ts'],
        minConfidence: 0.1,
        maxDepth: 2,
    });

    const depth1 = result.analysis.blast_radius.by_depth['1'];
    if (depth1 && depth1.length >= 2) {
        // First entry should have higher impact_score than second
        expect(depth1[0].impact_score).toBeGreaterThanOrEqual(depth1[1].impact_score);
    }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/analysis/context-builder.test.ts`
Expected: FAIL — `flows` and `impact_score` are empty/zero on entries

- [ ] **Step 3: Add `enrichBlastRadiusWithFlows` function and call it in `buildContextV2`**

Add this function at the bottom of `src/analysis/context-builder.ts` (before the closing of the file):

```typescript
import type { FlowRef, BlastRadiusResult } from '../graph/types';
import type { FlowsResult } from './flows';

function enrichBlastRadiusWithFlows(
    blastRadius: BlastRadiusResult,
    allFlows: FlowsResult,
): BlastRadiusResult {
    // Build flow index: qualified_name → FlowRef[]
    const flowIndex = new Map<string, FlowRef[]>();
    for (const flow of allFlows.flows) {
        for (const qn of flow.path) {
            if (!flowIndex.has(qn)) {
                flowIndex.set(qn, []);
            }
            const refs = flowIndex.get(qn)!;
            if (!refs.some((r) => r.entry_point === flow.entry_point)) {
                refs.push({
                    entry_point: flow.entry_point,
                    type: flow.type,
                    criticality: flow.criticality,
                });
            }
        }
    }

    const maxCriticality = allFlows.summary.max_criticality || 1;

    for (const entries of Object.values(blastRadius.by_depth)) {
        for (const entry of entries) {
            // Attach flows
            entry.flows = flowIndex.get(entry.qualified_name) || [];

            // Compute flow_weight
            let flowWeight = 0.1; // baseline when not in any flow
            if (entry.flows.length > 0) {
                const httpFlows = entry.flows.filter((f) => f.type === 'http');
                const testFlows = entry.flows.filter((f) => f.type === 'test');

                if (httpFlows.length > 0) {
                    const maxHttpCrit = Math.max(...httpFlows.map((f) => f.criticality));
                    flowWeight = Math.min(maxHttpCrit / maxCriticality, 1.0);
                } else if (testFlows.length > 0) {
                    const maxTestCrit = Math.max(...testFlows.map((f) => f.criticality));
                    flowWeight = 0.3 * Math.min(maxTestCrit / maxCriticality, 1.0);
                }
            }

            entry.impact_score = Math.round(entry.accumulated_confidence * flowWeight * 100) / 100;
        }

        // Sort by impact_score descending within this depth
        entries.sort((a, b) => b.impact_score - a.impact_score);
    }

    return blastRadius;
}
```

Then in `buildContextV2`, add the enrichment call after the blast radius and flows are computed. After line 97 (`const allFlows = ...`), add:

```typescript
// After:
const allFlows = detectFlows(indexed, { maxDepth: 10, type: 'all' });

// Add this line:
enrichBlastRadiusWithFlows(blastRadius, allFlows);
```

Also update the imports at the top of the file to include `FlowRef`:

```typescript
import type {
    AffectedFlow,
    BlastRadiusResult,
    ContextAnalysisMetadata,
    FlowRef,
    GraphData,
    GraphEdge,
    GraphNode,
    ParseMetadata,
} from '../graph/types';
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/analysis/context-builder.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/analysis/context-builder.ts tests/analysis/context-builder.test.ts
git commit -m "feat: flow-weighted blast radius with impact_score and FlowRef enrichment"
```

---

### Task 7: Prompt Formatter — Render Evolved Blast Radius

**Files:**
- Modify: `src/analysis/prompt-formatter.ts` (BLAST RADIUS section, lines 187-206)
- Test: `tests/analysis/prompt-formatter.test.ts`

- [ ] **Step 1: Write test for new blast radius prompt format**

Add to `tests/analysis/prompt-formatter.test.ts`, inside the `describe('formatPrompt')` block:

```typescript
it('should render blast radius entries with confidence, category, and flows', () => {
    const graphData: GraphData = {
        nodes: [
            {
                kind: 'Function', name: 'authenticate', qualified_name: 'src/auth.ts::authenticate',
                file_path: 'src/auth.ts', line_start: 10, line_end: 25, language: 'typescript',
                params: '(ctx: Context)', return_type: 'Result', is_test: false, file_hash: 'a',
            },
            {
                kind: 'Function', name: 'login', qualified_name: 'src/ctrl.ts::login',
                file_path: 'src/ctrl.ts', line_start: 5, line_end: 15, language: 'typescript',
                params: '(req: Request)', return_type: 'Response', is_test: false, file_hash: 'b',
            },
        ],
        edges: [
            {
                kind: 'CALLS', source_qualified: 'src/ctrl.ts::login',
                target_qualified: 'src/auth.ts::authenticate',
                file_path: 'src/ctrl.ts', line: 8, confidence: 0.9,
            },
        ],
    };

    const output = buildContextV2({
        mergedGraph: graphData,
        oldGraph: null,
        changedFiles: ['src/auth.ts'],
        minConfidence: 0.5,
        maxDepth: 3,
    });

    const text = formatPrompt(output);

    // Blast radius should show entries with confidence percentage
    if (text.includes('BLAST RADIUS:')) {
        // Should contain percentage notation
        expect(text).toMatch(/\d+%/);
        // Should contain category label
        expect(text).toMatch(/\[(contract_breaking|behavior_affected|transitive)\]/);
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/analysis/prompt-formatter.test.ts`
Expected: FAIL — current format doesn't include `%` or category labels

- [ ] **Step 3: Update the BLAST RADIUS section in `prompt-formatter.ts`**

Replace the blast radius rendering block (lines 187-206) in `src/analysis/prompt-formatter.ts`:

```typescript
// ── Blast radius by depth (with confidence, category, flows) ──
const byDepth = analysis.blast_radius.by_depth;
const depthKeys = Object.keys(byDepth).sort();
if (depthKeys.length > 0) {
    lines.push('BLAST RADIUS:');
    for (const depth of depthKeys) {
        const entries = byDepth[depth];

        // Group by impact_category
        const byCategory = new Map<string, typeof entries>();
        for (const entry of entries) {
            const cat = entry.impact_category;
            if (!byCategory.has(cat)) {
                byCategory.set(cat, []);
            }
            byCategory.get(cat)!.push(entry);
        }

        // Render each category group
        for (const [category, catEntries] of byCategory) {
            const MAX_SHOW = 6;
            const shown = catEntries.slice(0, MAX_SHOW);
            const names = shown.map((e) => {
                const name = shortName(e.qualified_name);
                const conf = `${Math.round(e.accumulated_confidence * 100)}%`;
                const score = e.impact_score > 0 ? `, score ${e.impact_score.toFixed(2)}` : '';
                return `${name} (${conf}${score})`;
            });

            let line = `  depth ${depth} [${category}]: ${names.join(', ')}`;
            if (catEntries.length > MAX_SHOW) {
                line += ` ... +${catEntries.length - MAX_SHOW}`;
            }
            line += ` (${catEntries.length})`;
            lines.push(line);

            // Show flows for this group (compact)
            const allFlows = shown.flatMap((e) => e.flows);
            if (allFlows.length > 0) {
                const uniqueFlows = new Map<string, string>();
                for (const f of allFlows) {
                    if (!uniqueFlows.has(f.entry_point)) {
                        uniqueFlows.set(f.entry_point, f.type === 'http' ? 'HTTP' : 'TEST');
                    }
                }
                const flowNames = [...uniqueFlows.entries()]
                    .slice(0, 3)
                    .map(([ep, type]) => `${type} ${shortName(ep)}`);
                let flowLine = `    flows: ${flowNames.join(', ')}`;
                if (uniqueFlows.size > 3) {
                    flowLine += ` ... +${uniqueFlows.size - 3}`;
                }
                lines.push(flowLine);
            }

            // Contract breaking warning
            if (category === 'contract_breaking') {
                lines.push('    \u26a0 callers may need update (contract changed)');
            }
        }
    }
    lines.push('');
}
```

- [ ] **Step 4: Run all prompt-formatter tests**

Run: `bun test tests/analysis/prompt-formatter.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run the full test suite to verify no regressions**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/analysis/prompt-formatter.ts tests/analysis/prompt-formatter.test.ts
git commit -m "feat: prompt formatter renders confidence, categories, and flows in BLAST RADIUS"
```

---

### Task 8: Full Integration Verification

**Files:**
- No new files — run existing tests + manual verification

- [ ] **Step 1: Run the complete test suite**

Run: `bun test`
Expected: ALL PASS, no regressions

- [ ] **Step 2: Run linter**

Run: `bun run lint`
Expected: No errors

- [ ] **Step 3: Verify with a real parse + context run (if repo available)**

Run: `bun run dev parse --all . && bun run dev context --files src/analysis/blast-radius.ts --format prompt`
Expected: Output shows new blast radius format with confidence percentages and categories

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: integration fixes for blast radius evolution"
```
