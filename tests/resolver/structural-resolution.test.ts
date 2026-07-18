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
 * Two structural-resolution gaps found by grading blast-radius recall against
 * the TypeScript compiler on kodus-ai/libs/code-review:
 *
 *  1. `this.method()` where the method is inherited from a base class — the
 *     class tier only looked in the enclosing subclass, so inherited self-calls
 *     were lost. It now walks the class hierarchy (like the receiver/DI tiers).
 *  2. A DI call `this.field.method()` to a generic-named method in the noise
 *     list (`get`/`set`/`has`/…) was dropped by the noise filter before the DI
 *     tier could resolve it against the field's injected type. The DI tier now
 *     runs before noise, so a structurally-resolvable DI call survives.
 */
const TMP = '/tmp/kodus-graph-structural-resolution';

function writeFixture(files: Record<string, string>) {
    rmSync(TMP, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(files)) {
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

describe('structural resolution completeness', () => {
    it('resolves a `this.method()` call to an inherited method up the class hierarchy', async () => {
        writeFixture({
            'src/base.ts': [
                'export abstract class Base {',
                '    helperMethod(): number {',
                '        return 1;',
                '    }',
                '}',
                '',
            ].join('\n'),
            'src/child.ts': [
                "import { Base } from './base';",
                '',
                'export class Child extends Base {',
                '    run(): number {',
                '        return this.helperMethod();',
                '    }',
                '}',
                '',
            ].join('\n'),
        });
        const { callEdges } = await build(TMP);

        const edge = callEdges.find((e) => e.callName === 'helperMethod');
        expect(edge).toBeDefined();
        expect(edge!.target).toBe('src/base.ts::Base.helperMethod');
        rmSync(TMP, { recursive: true, force: true });
    });

    it('resolves a DI call to a noise-named method instead of dropping it as noise', async () => {
        writeFixture({
            'src/cache.ts': [
                'export class Cache {',
                '    get(key: string): number {',
                '        return key.length;',
                '    }',
                '}',
                '',
            ].join('\n'),
            'src/service.ts': [
                "import { Cache } from './cache';",
                '',
                'export class Service {',
                '    constructor(private readonly cache: Cache) {}',
                '',
                '    run(): number {',
                "        return this.cache.get('x');",
                '    }',
                '}',
                '',
            ].join('\n'),
        });
        const { callEdges } = await build(TMP);

        // `get` is in the TS noise list; the DI tier (now before noise) must still
        // resolve it against the injected Cache type rather than dropping it.
        const edge = callEdges.find((e) => e.callName === 'get' && e.target.endsWith('Cache.get'));
        expect(edge).toBeDefined();
        expect(edge!.target).toBe('src/cache.ts::Cache.get');
        rmSync(TMP, { recursive: true, force: true });
    });
});
