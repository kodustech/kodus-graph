import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
// Side-effect import registers the TypeScript extractor + its noise set.
import '../../src/languages/typescript';
import { parseBatch } from '../../src/parser/batch';
import { discoverFiles } from '../../src/parser/discovery';
import { resolveCallsForGraph } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../../src/resolver/import-resolver';
import { createSymbolTable } from '../../src/resolver/symbol-table';

/**
 * Calibration gate — a hand-labeled mini-repo whose every in-repo call has one
 * known-correct target. Measured against the TypeScript compiler on kodus's own
 * source, the name-based tiers resolve at ~99% precision; this locks that in
 * with a self-contained fixture (no compiler dependency) so a resolver
 * regression fails `bun run check`.
 *
 * Each labeled call names its expected target and tier. The set deliberately
 * spans the tricky cases: a same-file free-function call, a cross-file import
 * call, an object-literal method shadowing an import (the real bug this gate
 * guards), and a unique cross-directory name.
 */
const TMP = '/tmp/kodus-graph-calibration-gate';

const FILES: Record<string, string> = {
    'src/shared.ts': ['export function helper(x: number): number {', '    return x + 1;', '}', ''].join('\n'),
    'src/util/unique.ts': ['export function uniquelyNamedHelper(): number {', '    return 7;', '}', ''].join('\n'),
    'src/a.ts': [
        "import { helper } from './shared';",
        '',
        'function localOnly(): number {',
        '    return 0;',
        '}',
        '',
        'export function runA(): number {',
        '    return helper(1) + localOnly();',
        '}',
        '',
    ].join('\n'),
    'src/obj.ts': [
        "import { helper } from './shared';",
        '',
        'export const objThing = {',
        '    helper(y: number): number {',
        '        return helper(y) * 2;',
        '    },',
        '};',
        '',
    ].join('\n'),
    'src/caller.ts': [
        "import { uniquelyNamedHelper } from './util/unique';",
        '',
        'export function runCaller(): number {',
        '    return uniquelyNamedHelper();',
        '}',
        '',
    ].join('\n'),
};

// Labeled ground truth. A CALLS edge carries the caller's FILE (not its
// qualified name), so calls are keyed by (caller file, call name) — unique per
// file in this fixture.
const GOLDEN: Array<{ file: string; call: string; target: string; tier: string }> = [
    { file: 'src/a.ts', call: 'helper', target: 'src/shared.ts::helper', tier: 'import' },
    { file: 'src/a.ts', call: 'localOnly', target: 'src/a.ts::localOnly', tier: 'same' },
    // Object-literal method shadowing the import — the call targets the import.
    { file: 'src/obj.ts', call: 'helper', target: 'src/shared.ts::helper', tier: 'import' },
    {
        file: 'src/caller.ts',
        call: 'uniquelyNamedHelper',
        target: 'src/util/unique.ts::uniquelyNamedHelper',
        tier: 'import',
    },
];

function setup() {
    rmSync(TMP, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(FILES)) {
        const abs = join(TMP, rel);
        mkdirSync(resolve(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
    }
}

async function build(repoDir: string) {
    const files = discoverFiles(repoDir, undefined);
    const rawGraph = await parseBatch(files, repoDir, {});
    const tsconfigAliases = loadTsconfigAliases(repoDir);
    const symbolTable = createSymbolTable();
    const importMap = createImportMap();
    for (const f of rawGraph.functions) {
        symbolTable.add(f.file, f.name, f.qualified);
    }
    for (const c of rawGraph.classes) {
        symbolTable.add(c.file, c.name, c.qualified);
    }
    for (const i of rawGraph.interfaces) {
        symbolTable.add(i.file, i.name, i.qualified);
    }
    for (const imp of rawGraph.imports) {
        const resolved = resolveImport(resolve(repoDir, imp.file), imp.module, imp.lang, repoDir, tsconfigAliases);
        const target = resolved ? resolve(repoDir, resolved).replace(`${repoDir}/`, '') : imp.module;
        for (const name of imp.names) {
            importMap.add(imp.file, name, target);
        }
    }
    return resolveCallsForGraph(rawGraph, symbolTable, importMap);
}

describe('call-resolution calibration gate', () => {
    it('resolves every labeled call to its correct target at 100% precision and recall', async () => {
        setup();
        const { callEdges } = await build(TMP);

        let found = 0;
        let correct = 0;
        for (const g of GOLDEN) {
            const edge = callEdges.find((e) => e.source === g.file && e.callName === g.call);
            if (!edge) {
                continue;
            }
            found++;
            expect(edge.target, `${g.file} -> ${g.call} should target ${g.target}`).toBe(g.target);
            if (edge.target === g.target) {
                correct++;
            }
        }

        const recall = found / GOLDEN.length;
        const precision = found === 0 ? 0 : correct / found;
        expect(recall).toBe(1);
        expect(precision).toBe(1);

        // No labeled call may resolve to the shadowing same-file method.
        expect(callEdges.some((e) => e.target === 'src/obj.ts::helper')).toBe(false);

        rmSync(TMP, { recursive: true, force: true });
    });
});
