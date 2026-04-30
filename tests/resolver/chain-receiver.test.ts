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

    it('singleton heuristic propagates receiver type for chained `Foo.getInstance().method()`', async () => {
        // Direct unit test: synthesize the two chained calls manually so the
        // test isolates the singleton heuristic from extractor-method visibility.
        const innerCall: RawCallSite = {
            source: 'src/log.ts',
            callName: 'getInstance',
            line: 5,
            column: 24,
            receiverType: 'Logger',
        };
        const outerCall: RawCallSite = {
            source: 'src/log.ts',
            callName: 'warn',
            line: 5,
            column: 30,
            chainedFromLine: 5,
            chainedFromColumn: 24,
        };
        const symbolTable = createSymbolTable();
        // Both methods exist in the symbol table — the inner is reachable via
        // receiver tier on its own, the outer needs the singleton propagation.
        symbolTable.add('src/log.ts', 'getInstance', 'src/log.ts::Logger.getInstance');
        symbolTable.add('src/log.ts', 'warn', 'src/log.ts::Logger.warn');

        const { callEdges, stats } = resolveAllCalls(
            [innerCall, outerCall],
            new Map(),
            symbolTable,
            createImportMap(),
            new Map(), // no return-type annotations on getInstance
        );
        const warnEdge = callEdges.find((e) => e.callName === 'warn');
        expect(warnEdge).toBeDefined();
        expect(warnEdge?.target).toBe('src/log.ts::Logger.warn');
        expect(warnEdge?.confidence).toBeGreaterThanOrEqual(0.9);
        // Both inner (Logger.getInstance via static) and outer (via singleton
        // chain propagation) land at the receiver tier.
        expect(stats.receiver).toBe(2);
    });

    it('deferred callee: `const x = factory(); x.method()` resolves via factory return type', async () => {
        // TS: `const x = factory(); x.method()` — receiver-type extractor records
        // `x → @CALLEE:factory` because there's no annotation/new/cast. Resolver
        // looks up factory's return type and substitutes.
        const code = [
            'function factory(): User { return new User(); }',
            'class User { greet(): string { return ""; } }',
            'function run() {',
            '  const x = factory();',
            '  x.greet();',
            '}',
        ].join('\n');
        const fp = 'src/factory.ts';
        const { rawCalls, symbolTable, importMap, returnTypes } = await prepare('TypeScript', code, fp);

        const greetCall = rawCalls.find((c) => c.callName === 'greet');
        // Pre-resolve: receiverType is the deferred marker.
        expect(greetCall?.receiverType).toBe('@CALLEE:factory');

        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), symbolTable, importMap, returnTypes);
        const greetEdge = callEdges.find((e) => e.callName === 'greet');
        expect(greetEdge).toBeDefined();
        expect(greetEdge?.target).toContain('User.greet');
        expect(greetEdge?.confidence).toBeGreaterThanOrEqual(0.9);
        expect(stats.receiver).toBeGreaterThanOrEqual(1);
    });

    it('deferred callee falls through gracefully when factory has no return type', async () => {
        // No return-type annotation on factory and no symbol table entry — the
        // resolver's deferred lookup returns undefined and the receiver tier
        // declines, falling through to other tiers (cascade / unique / etc).
        const calls: RawCallSite[] = [
            { source: 'src/a.ts', callName: 'doStuff', line: 5, column: 5, receiverType: '@CALLEE:unknownFactory' },
        ];
        const symbolTable = createSymbolTable();
        symbolTable.add('src/a.ts', 'doStuff', 'src/a.ts::Foo.doStuff');
        const { stats } = resolveAllCalls(calls, new Map(), symbolTable, createImportMap(), new Map());
        // Receiver tier declined (no factory in symbol table). Stats.receiver=0.
        expect(stats.receiver).toBe(0);
    });

    it('singleton heuristic does NOT propagate for non-factory inner names', async () => {
        // `Logger.transform()` is NOT in SINGLETON_FACTORIES. Without an explicit
        // return type, the chain pass declines to propagate; the outer call
        // doesn't get a receiverType boost and remains at its base tier.
        const innerCall: RawCallSite = {
            source: 'src/log.ts',
            callName: 'transform',
            line: 5,
            column: 22,
            receiverType: 'Logger',
        };
        const outerCall: RawCallSite = {
            source: 'src/log.ts',
            callName: 'warn',
            line: 5,
            column: 32,
            chainedFromLine: 5,
            chainedFromColumn: 22,
        };
        const symbolTable = createSymbolTable();
        symbolTable.add('src/log.ts', 'transform', 'src/log.ts::Logger.transform');
        symbolTable.add('src/log.ts', 'warn', 'src/log.ts::Logger.warn');

        const { stats } = resolveAllCalls([innerCall, outerCall], new Map(), symbolTable, createImportMap(), new Map());
        // Inner Logger.transform resolves at receiver tier (=1). The outer
        // wasn't propagated and didn't fire receiver — stats.receiver stays at 1.
        expect(stats.receiver).toBe(1);
    });
});
