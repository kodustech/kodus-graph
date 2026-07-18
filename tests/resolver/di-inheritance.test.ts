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
 * Regression for the DI-tier inheritance gap.
 *
 * A service injects a `Sub` (which `extends Base` and does NOT override
 * `doWork`) and calls `this.worker.doWork()`. The method is declared on `Base`,
 * so the CALLS edge must target `Base.doWork` — not a phantom `Sub.doWork` node
 * that has no declaration. Measured against the TS compiler on kodus-ai, the
 * DI tier attributing inherited methods to the concrete subclass broke the
 * blast radius into base methods (base-class entry points dropped out of the
 * transitive impact of many leaf symbols).
 */
const TMP = '/tmp/kodus-graph-di-inheritance';

function setup() {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'src'), { recursive: true });
    writeFileSync(
        join(TMP, 'src/base.ts'),
        ['export abstract class Base {', '    doWork(): number {', '        return 1;', '    }', '}', ''].join('\n'),
    );
    writeFileSync(
        join(TMP, 'src/sub.ts'),
        ["import { Base } from './base';", '', 'export class Sub extends Base {}', ''].join('\n'),
    );
    writeFileSync(
        join(TMP, 'src/service.ts'),
        [
            "import { Sub } from './sub';",
            '',
            'export class Service {',
            '    constructor(private readonly worker: Sub) {}',
            '',
            '    run(): number {',
            '        return this.worker.doWork();',
            '    }',
            '}',
            '',
        ].join('\n'),
    );
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

describe('DI tier inheritance resolution', () => {
    it('resolves a DI call to an inherited method to the BASE class that defines it, not a phantom subclass node', async () => {
        setup();
        const { callEdges } = await build(TMP);

        const edge = callEdges.find((e) => e.callName === 'doWork');
        expect(edge).toBeDefined();
        // Must target the base that actually declares doWork...
        expect(edge!.target).toBe('src/base.ts::Base.doWork');
        // ...never the concrete subclass, which has no doWork declaration.
        expect(callEdges.some((e) => e.target === 'src/sub.ts::Sub.doWork')).toBe(false);

        rmSync(TMP, { recursive: true, force: true });
    });
});
