import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawGraph } from '../../src/graph/types';
import { extractFromFile } from '../../src/parser/extractor';

// Side-effect import: register the Elixir extractor.
import '../../src/languages/elixir';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

function emptyGraph(): RawGraph {
    return {
        functions: [],
        classes: [],
        interfaces: [],
        enums: [],
        tests: [],
        imports: [],
        reExports: [],
        rawCalls: [],
        diMaps: new Map(),

        valueBindings: new Map(),
    };
}

async function extract(fixturePath: string): Promise<RawGraph> {
    const src = readFileSync(join(FIXTURES, fixturePath), 'utf-8');
    const tree = await parseAsync('elixir', src);
    const graph = emptyGraph();
    extractFromFile(tree, fixturePath, 'elixir', new Set(), graph);
    return graph;
}

/**
 * Elixir's grammar represents case/cond/with/try as a `call` node wrapping a
 * `do_block` whose arms are `stab_clause` nodes. A strict McCabe count needs
 * N-1 decisions for an N-arm switch, NOT N+1 (which is what you'd get from
 * counting both the outer `call` AND every `stab_clause`).
 *
 * These tests pin the strict McCabe numbers for the fixture's `classify` and
 * `check` functions so a regression of the double-count is caught.
 */
describe('Elixir cyclomatic complexity (strict McCabe)', () => {
    it('3-arm case yields complexity 3 (1 base + 2 decisions)', async () => {
        const graph = await extract('elixir/sample.ex');
        const classify = graph.functions.find((f) => f.name === 'classify');
        expect(classify).toBeDefined();
        expect(classify!.complexity).toBe(3);
    });

    it('3-arm cond yields complexity 3 (1 base + 2 decisions)', async () => {
        const graph = await extract('elixir/sample.ex');
        const check = graph.functions.find((f) => f.name === 'check');
        expect(check).toBeDefined();
        expect(check!.complexity).toBe(3);
    });

    it('if without else yields complexity 2 (1 base + 1 decision)', async () => {
        // Regression guard: the fix must not break existing if/unless/for
        // scalar-decision counting.
        const graph = await extract('elixir/sample.ex');
        const validate = graph.functions.find((f) => f.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate!.complexity).toBe(2);
    });
});
