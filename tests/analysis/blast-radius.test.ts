import { describe, expect, it } from 'bun:test';
import { computeBlastRadius } from '../../src/analysis/blast-radius';
import type { GraphData } from '../../src/graph/types';

describe('computeBlastRadius', () => {
    it('should find impacted nodes via CALLS edges', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'auth',
                    qualified_name: 'src/auth.ts::auth',
                    file_path: 'src/auth.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'login',
                    qualified_name: 'src/ctrl.ts::login',
                    file_path: 'src/ctrl.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'route',
                    qualified_name: 'src/routes.ts::route',
                    file_path: 'src/routes.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'src/ctrl.ts::login',
                    target_qualified: 'src/auth.ts::auth',
                    file_path: 'src/ctrl.ts',
                    line: 5,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'src/routes.ts::route',
                    target_qualified: 'src/ctrl.ts::login',
                    file_path: 'src/routes.ts',
                    line: 3,
                    confidence: 0.85,
                },
            ],
        };

        // Now pass qualified names instead of file paths
        const result = computeBlastRadius(graph, ['src/auth.ts::auth'], 2);

        // Seed (auth) + depth 1 (login) + depth 2 (route) = 3 total
        expect(result.total_functions).toBe(3);
        expect(result.total_files).toBe(3);

        const depth1 = result.by_depth['1'];
        expect(depth1).toBeDefined();
        expect(depth1.length).toBe(1);
        expect(depth1[0].qualified_name).toBe('src/ctrl.ts::login');
        expect(depth1[0].accumulated_confidence).toBeCloseTo(0.9, 2);

        const depth2 = result.by_depth['2'];
        expect(depth2).toBeDefined();
        expect(depth2.length).toBe(1);
        expect(depth2[0].qualified_name).toBe('src/routes.ts::route');
    });

    it('should respect maxDepth', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'a',
                    qualified_name: 'a.ts::a',
                    file_path: 'a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'x',
                },
                {
                    kind: 'Function',
                    name: 'b',
                    qualified_name: 'b.ts::b',
                    file_path: 'b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'y',
                },
                {
                    kind: 'Function',
                    name: 'c',
                    qualified_name: 'c.ts::c',
                    file_path: 'c.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'z',
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'b.ts::b',
                    target_qualified: 'a.ts::a',
                    file_path: 'b.ts',
                    line: 2,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'c.ts::c',
                    target_qualified: 'b.ts::b',
                    file_path: 'c.ts',
                    line: 2,
                    confidence: 0.9,
                },
            ],
        };

        // Now pass qualified names instead of file paths
        const depth1 = computeBlastRadius(graph, ['a.ts::a'], 1);
        const depth2 = computeBlastRadius(graph, ['a.ts::a'], 2);
        expect(depth2.total_functions).toBeGreaterThanOrEqual(depth1.total_functions);
    });

    it('should only use provided qualified names as seeds (not all file nodes)', () => {
        // File A has func1, func2, func3 — only func1 changed
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'func1',
                    qualified_name: 'A.ts::func1',
                    file_path: 'A.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'func2',
                    qualified_name: 'A.ts::func2',
                    file_path: 'A.ts',
                    line_start: 6,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'func3',
                    qualified_name: 'A.ts::func3',
                    file_path: 'A.ts',
                    line_start: 11,
                    line_end: 15,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'callerOfFunc1',
                    qualified_name: 'B.ts::callerOfFunc1',
                    file_path: 'B.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h2',
                },
                {
                    kind: 'Function',
                    name: 'callerOfFunc2',
                    qualified_name: 'C.ts::callerOfFunc2',
                    file_path: 'C.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h3',
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'B.ts::callerOfFunc1',
                    target_qualified: 'A.ts::func1',
                    file_path: 'B.ts',
                    line: 2,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'C.ts::callerOfFunc2',
                    target_qualified: 'A.ts::func2',
                    file_path: 'C.ts',
                    line: 2,
                    confidence: 0.9,
                },
            ],
        };

        // Only func1 changed — blast radius should NOT include callerOfFunc2
        const result = computeBlastRadius(graph, ['A.ts::func1'], 2);

        // Should include func1 (seed) + callerOfFunc1 (depth 1)
        expect(result.total_functions).toBe(2);
        // Should NOT include callerOfFunc2 since func2 was not a seed
        const allReached = new Set<string>();
        allReached.add('A.ts::func1'); // seed
        for (const entries of Object.values(result.by_depth)) {
            for (const e of entries) {
                allReached.add(e.qualified_name);
            }
        }
        expect(allReached.has('B.ts::callerOfFunc1')).toBe(true);
        expect(allReached.has('C.ts::callerOfFunc2')).toBe(false);
        expect(allReached.has('A.ts::func2')).toBe(false);
        expect(allReached.has('A.ts::func3')).toBe(false);
    });

    it('should filter CALLS edges by minConfidence', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'target',
                    qualified_name: 'x.ts::target',
                    file_path: 'x.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'highConfCaller',
                    qualified_name: 'y.ts::highConfCaller',
                    file_path: 'y.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h2',
                },
                {
                    kind: 'Function',
                    name: 'lowConfCaller',
                    qualified_name: 'z.ts::lowConfCaller',
                    file_path: 'z.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h3',
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'y.ts::highConfCaller',
                    target_qualified: 'x.ts::target',
                    file_path: 'y.ts',
                    line: 2,
                    confidence: 0.8,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'z.ts::lowConfCaller',
                    target_qualified: 'x.ts::target',
                    file_path: 'z.ts',
                    line: 2,
                    confidence: 0.3,
                },
            ],
        };

        // With minConfidence=0.5, low-confidence edge should NOT propagate
        const result = computeBlastRadius(graph, ['x.ts::target'], 2, 0.5);
        expect(result.total_functions).toBe(2); // target + highConfCaller

        const allReached = new Set<string>();
        allReached.add('x.ts::target');
        for (const entries of Object.values(result.by_depth)) {
            for (const e of entries) {
                allReached.add(e.qualified_name);
            }
        }
        expect(allReached.has('y.ts::highConfCaller')).toBe(true);
        expect(allReached.has('z.ts::lowConfCaller')).toBe(false);

        // With minConfidence=0.1, both should propagate
        const resultLow = computeBlastRadius(graph, ['x.ts::target'], 2, 0.1);
        expect(resultLow.total_functions).toBe(3);
    });

    it('should NOT filter IMPORTS edges by confidence', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'util',
                    qualified_name: 'util.ts::util',
                    file_path: 'util.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'consumer',
                    qualified_name: 'consumer.ts::consumer',
                    file_path: 'consumer.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h2',
                },
            ],
            edges: [
                {
                    // IMPORTS edge has no confidence field
                    kind: 'IMPORTS',
                    source_qualified: 'consumer.ts::consumer',
                    target_qualified: 'util.ts::util',
                    file_path: 'consumer.ts',
                    line: 1,
                },
            ],
        };

        // IMPORTS edges should always be followed regardless of minConfidence
        const result = computeBlastRadius(graph, ['util.ts::util'], 2, 0.99);
        expect(result.total_functions).toBe(2); // util + consumer

        const allReached = new Set<string>();
        allReached.add('util.ts::util');
        for (const entries of Object.values(result.by_depth)) {
            for (const e of entries) {
                allReached.add(e.qualified_name);
            }
        }
        expect(allReached.has('consumer.ts::consumer')).toBe(true);
    });

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
                    kind: 'IMPORTS',
                    source_qualified: 'app.ts::app',
                    target_qualified: 'utils.ts::utils',
                    file_path: 'app.ts',
                    line: 1,
                },
            ],
        };

        const result = computeBlastRadius(graph, ['app.ts::app'], 2);
        expect(result.total_functions).toBe(1);

        const allReached = new Set<string>(['app.ts::app']);
        for (const entries of Object.values(result.by_depth)) {
            for (const e of entries) {
                allReached.add(e.qualified_name);
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

        const result = computeBlastRadius(graph, ['utils.ts::utils'], 2);
        expect(result.total_functions).toBe(2);

        const allReached = new Set<string>(['utils.ts::utils']);
        for (const entries of Object.values(result.by_depth)) {
            for (const e of entries) {
                allReached.add(e.qualified_name);
            }
        }
        expect(allReached.has('app.ts::app')).toBe(true);
    });

    // ── New tests for confidence-weighted BFS ──

    it('should propagate accumulated confidence through CALLS chain', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'a',
                    qualified_name: 'a.ts::a',
                    file_path: 'a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'x',
                },
                {
                    kind: 'Function',
                    name: 'b',
                    qualified_name: 'b.ts::b',
                    file_path: 'b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'y',
                },
                {
                    kind: 'Function',
                    name: 'c',
                    qualified_name: 'c.ts::c',
                    file_path: 'c.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'z',
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'b.ts::b',
                    target_qualified: 'a.ts::a',
                    file_path: 'b.ts',
                    line: 2,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'c.ts::c',
                    target_qualified: 'b.ts::b',
                    file_path: 'c.ts',
                    line: 2,
                    confidence: 0.8,
                },
            ],
        };

        const result = computeBlastRadius(graph, ['a.ts::a'], 3);

        const depth1 = result.by_depth['1'];
        expect(depth1).toBeDefined();
        const bEntry = depth1.find((e) => e.qualified_name === 'b.ts::b');
        expect(bEntry).toBeDefined();
        expect(bEntry!.accumulated_confidence).toBeCloseTo(0.9, 2);
        expect(bEntry!.edge_kind).toBe('CALLS');

        const depth2 = result.by_depth['2'];
        expect(depth2).toBeDefined();
        const cEntry = depth2.find((e) => e.qualified_name === 'c.ts::c');
        expect(cEntry).toBeDefined();
        expect(cEntry!.accumulated_confidence).toBeCloseTo(0.72, 2);
    });

    it('should use highest accumulated confidence when node is reachable via multiple paths', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'target',
                    qualified_name: 'x.ts::target',
                    file_path: 'x.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'pathA',
                    qualified_name: 'a.ts::pathA',
                    file_path: 'a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h2',
                },
                {
                    kind: 'Function',
                    name: 'pathB',
                    qualified_name: 'b.ts::pathB',
                    file_path: 'b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h3',
                },
                {
                    kind: 'Function',
                    name: 'shared',
                    qualified_name: 's.ts::shared',
                    file_path: 's.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h4',
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'a.ts::pathA',
                    target_qualified: 'x.ts::target',
                    file_path: 'a.ts',
                    line: 2,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 's.ts::shared',
                    target_qualified: 'a.ts::pathA',
                    file_path: 's.ts',
                    line: 2,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'b.ts::pathB',
                    target_qualified: 'x.ts::target',
                    file_path: 'b.ts',
                    line: 2,
                    confidence: 0.5,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 's.ts::shared',
                    target_qualified: 'b.ts::pathB',
                    file_path: 's.ts',
                    line: 3,
                    confidence: 0.5,
                },
            ],
        };

        const result = computeBlastRadius(graph, ['x.ts::target'], 3);

        const depth2 = result.by_depth['2'];
        expect(depth2).toBeDefined();
        const sharedEntry = depth2.find((e) => e.qualified_name === 's.ts::shared');
        expect(sharedEntry).toBeDefined();
        expect(sharedEntry!.accumulated_confidence).toBeCloseTo(0.81, 2);
    });

    it('should handle cycles without infinite loop', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'a',
                    qualified_name: 'a.ts::a',
                    file_path: 'a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'x',
                },
                {
                    kind: 'Function',
                    name: 'b',
                    qualified_name: 'b.ts::b',
                    file_path: 'b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'y',
                },
                {
                    kind: 'Function',
                    name: 'c',
                    qualified_name: 'c.ts::c',
                    file_path: 'c.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'z',
                },
            ],
            edges: [
                // Cycle: b calls a, c calls b, a calls c
                {
                    kind: 'CALLS',
                    source_qualified: 'b.ts::b',
                    target_qualified: 'a.ts::a',
                    file_path: 'b.ts',
                    line: 2,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'c.ts::c',
                    target_qualified: 'b.ts::b',
                    file_path: 'c.ts',
                    line: 2,
                    confidence: 0.9,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'a.ts::a',
                    target_qualified: 'c.ts::c',
                    file_path: 'a.ts',
                    line: 2,
                    confidence: 0.9,
                },
            ],
        };

        // Should terminate without infinite loop and find b and c
        const result = computeBlastRadius(graph, ['a.ts::a'], 5);
        expect(result.total_functions).toBeLessThanOrEqual(3);
        expect(result.total_functions).toBeGreaterThanOrEqual(2); // at least a + b

        // Verify no duplicate entries across depths
        const allQualified = new Set<string>();
        for (const entries of Object.values(result.by_depth)) {
            for (const e of entries) {
                expect(allQualified.has(e.qualified_name)).toBe(false); // no duplicates
                allQualified.add(e.qualified_name);
            }
        }
    });

    it('should update impact_category when higher-confidence path revisits a depth-1 node', () => {
        // Scenario:
        //   seed (contract_breaking seed) --CALLS(0.6)--> nodeA  [depth 1, initially behavior_affected via non-contract path]
        //   seed2 (contract_breaking seed) --CALLS(0.9)--> nodeA  [depth 1, higher confidence, contract_breaking path]
        //
        // nodeA is first seen via a non-contract seed with conf=0.6 → behavior_affected
        // Then at depth 2 a higher-confidence path arrives via a contract seed → should become contract_breaking
        //
        // Simpler: two seeds, nodeA reachable from both at depth 1.
        // We test the "same depth dedup" at depth 1 (frontierBest dedup) then also the
        // "earlier depth revisit" scenario by setting up a depth-2 path that has higher conf.
        //
        // For the "earlier depth revisit" branch specifically:
        //   - A changes at depth 1 via seed (non-contract, conf=0.5) → behavior_affected
        //   - B is at depth 1, C is at depth 2
        //   - C calls A directly with conf=0.9 via contractSeed path (comes through depth-2 BFS)
        //   - Since A is at depth 1 and 0.9 > 0.5, impact_category should update to contract_breaking

        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'seed',
                    qualified_name: 'seed.ts::seed',
                    file_path: 'seed.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h0',
                },
                {
                    kind: 'Function',
                    name: 'nodeA',
                    qualified_name: 'a.ts::nodeA',
                    file_path: 'a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'nodeB',
                    qualified_name: 'b.ts::nodeB',
                    file_path: 'b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h2',
                },
            ],
            edges: [
                // nodeA calls seed with low confidence (so nodeA is depth-1, behavior_affected initially)
                {
                    kind: 'CALLS',
                    source_qualified: 'a.ts::nodeA',
                    target_qualified: 'seed.ts::seed',
                    file_path: 'a.ts',
                    line: 2,
                    confidence: 0.5,
                },
                // nodeB calls seed with some confidence (nodeB is depth-1)
                {
                    kind: 'CALLS',
                    source_qualified: 'b.ts::nodeB',
                    target_qualified: 'seed.ts::seed',
                    file_path: 'b.ts',
                    line: 2,
                    confidence: 0.6,
                },
                // nodeA also calls nodeB — so at depth 2, nodeA is reachable via nodeB with higher accumulated conf
                // BUT nodeA is already at depth 1 (0.5). The depth-2 path conf = 0.6 * 0.95 = 0.57 > 0.5
                // And seed is in contractBreakingSeeds, so the path through nodeB (originSeed=seed) should mark contract_breaking
                {
                    kind: 'CALLS',
                    source_qualified: 'a.ts::nodeA',
                    target_qualified: 'b.ts::nodeB',
                    file_path: 'a.ts',
                    line: 3,
                    confidence: 0.95,
                },
            ],
        };

        // seed is a contract-breaking seed
        const contractBreakingSeeds = new Set(['seed.ts::seed']);

        const result = computeBlastRadius(graph, ['seed.ts::seed'], 3, 0.1, contractBreakingSeeds);

        // nodeA should be in depth 1
        const depth1 = result.by_depth['1'];
        expect(depth1).toBeDefined();
        const nodeAEntry = depth1.find((e) => e.qualified_name === 'a.ts::nodeA');
        expect(nodeAEntry).toBeDefined();

        // The higher-confidence path (through nodeB at depth 2, conf=0.6*0.95=0.57) should win over 0.5
        // and since seed is in contractBreakingSeeds, impact_category must be contract_breaking
        expect(nodeAEntry!.accumulated_confidence).toBeCloseTo(0.57, 2);
        expect(nodeAEntry!.impact_category).toBe('contract_breaking');
    });

    it('should handle empty graph', () => {
        const graph: GraphData = { nodes: [], edges: [] };
        const result = computeBlastRadius(graph, ['nonexistent::fn'], 2);
        expect(result.total_functions).toBe(1); // only the seed (even if not in graph)
        expect(result.total_files).toBe(0);
        expect(Object.keys(result.by_depth)).toHaveLength(0);
    });

    it('should handle empty seeds', () => {
        const graph: GraphData = {
            nodes: [
                { kind: 'Function', name: 'a', qualified_name: 'a.ts::a', file_path: 'a.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false },
            ],
            edges: [],
        };
        const result = computeBlastRadius(graph, [], 2);
        expect(result.total_functions).toBe(0);
        expect(result.total_files).toBe(0);
        expect(Object.keys(result.by_depth)).toHaveLength(0);
    });

    it('should set accumulated_confidence to 1.0 for IMPORTS edges', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'util',
                    qualified_name: 'util.ts::util',
                    file_path: 'util.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
                {
                    kind: 'Function',
                    name: 'consumer',
                    qualified_name: 'consumer.ts::consumer',
                    file_path: 'consumer.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h2',
                },
            ],
            edges: [
                {
                    kind: 'IMPORTS',
                    source_qualified: 'consumer.ts::consumer',
                    target_qualified: 'util.ts::util',
                    file_path: 'consumer.ts',
                    line: 1,
                },
            ],
        };

        const result = computeBlastRadius(graph, ['util.ts::util'], 2, 0.99);

        const depth1 = result.by_depth['1'];
        expect(depth1).toBeDefined();
        const consumerEntry = depth1.find((e) => e.qualified_name === 'consumer.ts::consumer');
        expect(consumerEntry).toBeDefined();
        expect(consumerEntry!.accumulated_confidence).toBe(1.0);
        expect(consumerEntry!.edge_kind).toBe('IMPORTS');
    });
});
