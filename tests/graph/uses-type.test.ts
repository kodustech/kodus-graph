import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';

import type { BlastRadiusResult, GraphData, GraphEdge } from '../../src/graph/types';
import { runCli } from '../helpers/run-cli';

/**
 * Types are a dependency the call graph cannot see.
 *
 * `checkout(order: Order)` never calls anything in `types.ts`, so with CALLS and
 * IMPORTS alone, changing `Order` — renaming a field, adding a required one —
 * reported a blast radius of ZERO while every function taking one broke. IMPORTS
 * edges do exist, but they are file-to-file while the blast radius seeds from
 * symbols, so the two never meet.
 *
 * USES_TYPE closes that. It is deliberately not a per-language type parser:
 * every identifier in a signature is offered to `resolveTypeName`, which only
 * resolves names this file imported and this repo declares, and the resolution
 * must land on a Class/Interface/Enum. `string`, `number` and a parameter named
 * `order` all fail and disappear.
 */

const FIXTURE = resolve('tests/fixtures/type-only-repo');

function parseFixture(): GraphData {
    const out = '/tmp/kodus-graph-uses-type.json';
    runCli(['parse', '--all', '--repo-dir', FIXTURE, '--out', out]);
    const g = JSON.parse(readFileSync(out, 'utf-8')) as GraphData;
    rmSync(out, { force: true });
    return g;
}

function analyze(files: string): BlastRadiusResult {
    const graph = '/tmp/kodus-graph-uses-type-graph.json';
    const out = '/tmp/kodus-graph-uses-type-analysis.json';
    try {
        runCli(['parse', '--all', '--repo-dir', FIXTURE, '--out', graph]);
        runCli(['analyze', '--files', files, '--graph', graph, '--repo-dir', FIXTURE, '--out', out]);
        return (JSON.parse(readFileSync(out, 'utf-8')) as { blast_radius: BlastRadiusResult }).blast_radius;
    } finally {
        rmSync(graph, { force: true });
        rmSync(out, { force: true });
    }
}

const usesType = (g: GraphData): GraphEdge[] => g.edges.filter((e) => e.kind === 'USES_TYPE');

describe('USES_TYPE: a signature naming a repo type is a dependency', () => {
    const graph = parseFixture();

    it('links a function to the type in its signature', () => {
        const pairs = usesType(graph).map((e) => `${e.source_qualified} -> ${e.target_qualified}`);

        expect(pairs).toContain('src/checkout.ts::checkout -> src/types.ts::Order');
        expect(pairs).toContain('src/report.ts::summarize -> src/types.ts::Order');
        // Enums count too — a signature naming one depends on its shape.
        expect(pairs).toContain('src/report.ts::summarize -> src/types.ts::Status');
    });

    it('emits nothing for primitives or parameter names', () => {
        // `slugify(text: string, max: number): string` names no repo type.
        const fromUtil = usesType(graph).filter((e) => e.source_qualified.startsWith('src/util.ts'));
        expect(fromUtil).toEqual([]);

        // The resolver is the filter: no edge may target something that isn't a
        // type this repo declares.
        const typeNodes = new Set(
            graph.nodes.filter((n) => ['Class', 'Interface', 'Enum'].includes(n.kind)).map((n) => n.qualified_name),
        );
        for (const e of usesType(graph)) {
            expect(typeNodes.has(e.target_qualified)).toBe(true);
        }
    });

    it('puts type users in the blast radius of the type', () => {
        const blast = analyze('src/types.ts');

        const reached = Object.values(blast.by_depth)
            .flat()
            .map((e) => e.qualified_name)
            .sort();

        // Before USES_TYPE: total_functions 1, by_depth {} — two functions broke
        // and the graph reported nothing.
        expect(reached).toEqual(['src/checkout.ts::checkout', 'src/report.ts::summarize']);
        expect(blast.total_functions).toBeGreaterThan(1);
    });

    it('carries a confidence below the receiver tier, and decays', () => {
        const blast = analyze('src/types.ts');
        const entries = Object.values(blast.by_depth).flat();

        for (const e of entries) {
            expect(e.edge_kind).toBe('USES_TYPE');
            // Naming a type is real evidence of dependency, but not proof that
            // every change to it breaks the signature — widening a union or
            // adding an optional field usually doesn't.
            expect(e.accumulated_confidence).toBeLessThan(0.95);
            expect(e.accumulated_confidence).toBeGreaterThanOrEqual(0.5);
        }
    });

    it('survives a round-trip through the graph schema', () => {
        // EdgeKind, the loader's Zod enum and shared/schemas each spelled the
        // kinds out separately; adding one to the type left both validators
        // rejecting graphs this code had just written, and `analyze --graph`
        // silently fell back to a graph-less path instead of failing.
        const graphPath = '/tmp/kodus-graph-uses-type-roundtrip.json';
        const out = '/tmp/kodus-graph-uses-type-roundtrip-analysis.json';
        try {
            runCli(['parse', '--all', '--repo-dir', FIXTURE, '--out', graphPath]);
            // Throws on a validation error rather than degrading quietly.
            runCli(['analyze', '--files', 'src/types.ts', '--graph', graphPath, '--repo-dir', FIXTURE, '--out', out]);
            expect(usesType(JSON.parse(readFileSync(graphPath, 'utf-8')) as GraphData).length).toBeGreaterThan(0);
        } finally {
            rmSync(graphPath, { force: true });
            rmSync(out, { force: true });
        }
    });
});
