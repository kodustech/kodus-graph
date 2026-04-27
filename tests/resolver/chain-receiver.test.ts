import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import type { RawCallSite, RawFunction } from '../../src/graph/types';
import { extractReceiverTypesFromEngine } from '../../src/languages/engine';
import { locationKey } from '../../src/languages/receiver-types';
import '../../src/parser/languages';
import { extractCallsFromFile, extractFromFile } from '../../src/parser/extractor';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';

interface PreparedGraph {
    rawCalls: RawCallSite[];
    functions: RawFunction[];
    symbolTable: ReturnType<typeof createSymbolTable>;
    importMap: ReturnType<typeof createImportMap>;
    returnTypes: Map<string, string>;
}

async function prepare(lang: string, source: string, fp: string): Promise<PreparedGraph> {
    const root = await parseAsync(lang as never, source);
    const graph = {
        functions: [] as RawFunction[],
        classes: [],
        interfaces: [],
        enums: [],
        tests: [],
        imports: [],
        reExports: [],
        rawCalls: [] as RawCallSite[],
        diMaps: new Map(),
    };
    extractFromFile(root, fp, lang, new Set(), graph);
    extractCallsFromFile(root, fp, lang, graph.rawCalls);

    const map = extractReceiverTypesFromEngine(root, fp, lang);
    for (const call of graph.rawCalls) {
        const rt = map.get(locationKey(fp, call.line, call.column ?? -1));
        if (rt) {
            call.receiverType = rt;
        }
    }

    const symbolTable = createSymbolTable();
    for (const f of graph.functions) {
        symbolTable.add(f.file, f.name, f.qualified);
    }
    for (const c of graph.classes as { file: string; name: string; qualified: string }[]) {
        symbolTable.add(c.file, c.name, c.qualified);
    }

    const returnTypes = new Map<string, string>();
    for (const f of graph.functions) {
        if (f.returnType) {
            returnTypes.set(f.qualified, f.returnType);
        }
    }

    return {
        rawCalls: graph.rawCalls,
        functions: graph.functions,
        symbolTable,
        importMap: createImportMap(),
        returnTypes,
    };
}

describe('method-chain receiver inference', () => {
    it('TypeScript: outer call inherits return type of inner call', async () => {
        const code = [
            'class User { greet(): string { return ""; } }',
            'class Repo { find(): User { return new User(); } }',
            'function run() {',
            '  const repo = new Repo();',
            '  return repo.find().greet();',
            '}',
        ].join('\n');
        const fp = 'src/chain.ts';
        const { rawCalls, symbolTable, importMap, returnTypes } = await prepare('TypeScript', code, fp);

        const innerCall = rawCalls.find((c) => c.callName === 'find');
        const outerCall = rawCalls.find((c) => c.callName === 'greet');
        expect(innerCall).toBeDefined();
        expect(outerCall).toBeDefined();
        expect(outerCall?.chainedFromLine).toBe(innerCall?.line);
        expect(outerCall?.chainedFromColumn).toBe(innerCall?.column);

        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), symbolTable, importMap, returnTypes);

        const greetEdge = callEdges.find((e) => e.callName === 'greet');
        expect(greetEdge).toBeDefined();
        expect(greetEdge?.target).toContain('User.greet');
        expect(greetEdge?.confidence).toBeGreaterThanOrEqual(0.9);
        expect(stats.receiver).toBeGreaterThanOrEqual(2);
    });

    it('TypeScript: chain through Promise<T> unwraps to T', async () => {
        const code = [
            'class User { greet(): string { return ""; } }',
            'class Repo { find(): Promise<User> { return Promise.resolve(new User()); } }',
            'async function run() {',
            '  const repo = new Repo();',
            '  return (await repo.find()).greet();',
            '}',
        ].join('\n');
        const fp = 'src/promise.ts';
        const { rawCalls, symbolTable, importMap, returnTypes } = await prepare('TypeScript', code, fp);

        const { callEdges } = resolveAllCalls(rawCalls, new Map(), symbolTable, importMap, returnTypes);
        const greetEdge = callEdges.find((e) => e.callName === 'greet');
        // Even with await wrapping, the promise unwrap is from the inner call's
        // return-type signature `Promise<User>` → `User`. greet should resolve.
        expect(greetEdge).toBeDefined();
        expect(greetEdge?.target).toContain('User.greet');
    });
});
