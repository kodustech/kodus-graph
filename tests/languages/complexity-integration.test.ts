import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawGraph } from '../../src/graph/types';
import { extractFromFile } from '../../src/parser/extractor';

// Side-effect imports: register all extractors.
import '../../src/languages/typescript';
import '../../src/languages/python';
import '../../src/languages/ruby';
import '../../src/languages/go';
import '../../src/languages/java';
import '../../src/languages/kotlin';
import '../../src/languages/rust';
import '../../src/languages/csharp';
import '../../src/languages/php';
import '../../src/languages/swift';
import '../../src/languages/dart';
import '../../src/languages/scala';
import '../../src/languages/c';
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

async function extract(lang: string, fixturePath: string): Promise<RawGraph> {
    const src = readFileSync(join(FIXTURES, fixturePath), 'utf-8');
    const tree = await parseAsync(lang as Parameters<typeof parseAsync>[0], src);
    const graph = emptyGraph();
    extractFromFile(tree, fixturePath, lang, new Set(), graph);
    return graph;
}

/**
 * Each case pins a concrete expected complexity on ONE named function in the
 * fixture — this is the regression guard. A plain `>=1` check passes even if
 * a typo like `if_statment` in a language's BRANCH_KINDS list silently
 * collapses every function to 1. Pinning a value catches that.
 *
 * Expected values are hand-computed from the fixture + the language's
 * BRANCH_KINDS: `expectedComplexity = 1 + count(decision-point kinds in body)`.
 */
const CASES: {
    lang: string;
    path: string;
    expectedFn: string;
    expectedComplexity: number;
}[] = [
    // authenticate: 1 `if_statement` → 1 + 1 = 2
    { lang: 'TypeScript', path: 'sample-repo/src/auth.ts', expectedFn: 'authenticate', expectedComplexity: 2 },
    // classify: 1 `if_statement` + 1 `elif_clause` → 1 + 2 = 3
    { lang: 'python', path: 'python/sample.py', expectedFn: 'classify', expectedComplexity: 3 },
    // classify: 1 `if` + 1 `elsif` → 1 + 2 = 3
    { lang: 'ruby', path: 'ruby/sample.rb', expectedFn: 'classify', expectedComplexity: 3 },
    // classify: 2 `if_statement` (else-if is a nested if_statement) → 1 + 2 = 3
    { lang: 'go', path: 'go/sample.go', expectedFn: 'classify', expectedComplexity: 3 },
    // classify: 2 `if_statement` (else if = nested if) → 1 + 2 = 3
    { lang: 'java', path: 'java/Sample.java', expectedFn: 'classify', expectedComplexity: 3 },
    // classify: 2 `if_expression` → 1 + 2 = 3
    { lang: 'kotlin', path: 'kotlin/Sample.kt', expectedFn: 'classify', expectedComplexity: 3 },
    // classify: 2 `if_expression` → 1 + 2 = 3
    { lang: 'rust', path: 'rust/sample.rs', expectedFn: 'classify', expectedComplexity: 3 },
    // Classify: 2 `if_statement` → 1 + 2 = 3
    { lang: 'csharp', path: 'csharp/Sample.cs', expectedFn: 'Classify', expectedComplexity: 3 },
    // classify: 1 `if_statement` + 1 `else_if_clause` → 1 + 2 = 3
    { lang: 'php', path: 'php/Sample.php', expectedFn: 'classify', expectedComplexity: 3 },
    // classify: 2 `if_statement` → 1 + 2 = 3
    { lang: 'swift', path: 'swift/Sample.swift', expectedFn: 'classify', expectedComplexity: 3 },
    // _validate: 1 `if_statement` → 1 + 1 = 2
    { lang: 'dart', path: 'dart/sample.dart', expectedFn: '_validate', expectedComplexity: 2 },
    // classify: 2 `if_expression` → 1 + 2 = 3
    { lang: 'scala', path: 'scala/Sample.scala', expectedFn: 'classify', expectedComplexity: 3 },
    // process_user: 1 `if_statement` → 1 + 1 = 2
    { lang: 'c', path: 'c/sample.c', expectedFn: 'process_user', expectedComplexity: 2 },
    // validate: 1 `call target=if` (no else) → 1 + 1 = 2.
    // This case pins the if/else "no-double-count" contract: if the
    // extractor counts both `call=if` AND an `else_block`, a plain if/else
    // would read as 3 instead of 2. See ELIXIR_BRANCH_KINDS for the fix.
    { lang: 'elixir', path: 'elixir/sample.ex', expectedFn: 'validate', expectedComplexity: 2 },
];

describe('complexity is populated per language', () => {
    for (const c of CASES) {
        it(`${c.lang} extractor sets complexity on every function`, async () => {
            const graph = await extract(c.lang, c.path);
            expect(graph.functions.length).toBeGreaterThan(0);
            for (const fn of graph.functions) {
                expect(typeof fn.complexity).toBe('number');
                expect(fn.complexity!).toBeGreaterThanOrEqual(1);
            }
            // Pin one concrete complexity so a kind-list regression
            // (e.g. a typo like `if_statment`) is caught — otherwise every
            // function silently defaults to 1 and the >=1 check still passes.
            const target = graph.functions.find((f) => f.name === c.expectedFn);
            expect(target).toBeDefined();
            expect(target!.complexity).toBe(c.expectedComplexity);
        });
    }
});
