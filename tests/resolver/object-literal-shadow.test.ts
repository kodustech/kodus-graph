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
 * Regression for the object-literal-method / import shadow.
 *
 * `mod.ts` imports a free function `helper` AND defines an object-literal
 * shorthand method also named `helper`. Inside that method an unqualified
 * `helper(y)` call targets the IMPORTED function — a method name is not a
 * lexical binding, so it never shadows the import. The resolver used to prefer
 * the same-file symbol (0.85) and wrongly pointed the edge at `mod.ts::helper`;
 * measured against the TypeScript compiler this was the single real
 * call-resolution error class in kodus-graph's own source (every language
 * extractor's `extractCalls` shadowing the shared one).
 */
const TMP = '/tmp/kodus-graph-obj-literal-shadow';

function setup() {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'src'), { recursive: true });
    writeFileSync(join(TMP, 'src/shared.ts'), 'export function helper(x: number): number {\n    return x + 1;\n}\n');
    writeFileSync(
        join(TMP, 'src/mod.ts'),
        [
            "import { helper } from './shared';",
            '',
            'export const modExtractor = {',
            '    helper(y: number): number {',
            '        return helper(y) * 2;',
            '    },',
            '};',
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
    return { rawGraph, symbolTable, importMap };
}

describe('object-literal method shadowing an import', () => {
    it('resolves an unqualified call in the method body to the IMPORT, not the same-file method', async () => {
        setup();
        const { rawGraph, symbolTable, importMap } = await build(TMP);
        const { callEdges } = resolveCallsForGraph(rawGraph, symbolTable, importMap);

        const helperEdge = callEdges.find((e) => e.callName === 'helper');
        expect(helperEdge).toBeDefined();
        // The edge must point at the imported free function...
        expect(helperEdge!.target).toBe('src/shared.ts::helper');
        // ...and never at the same-file object-literal method.
        expect(callEdges.some((e) => e.target === 'src/mod.ts::helper')).toBe(false);

        rmSync(TMP, { recursive: true, force: true });
    });
});
