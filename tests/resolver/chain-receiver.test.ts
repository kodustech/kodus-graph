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

        valueBindings: new Map(),
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

    it('Python: `x = factory()` resolves outer call via factory return-type annotation', async () => {
        const code = [
            'class User:',
            '    def greet(self): return ""',
            '',
            'def factory() -> User:',
            '    return User()',
            '',
            'def run():',
            '    x = factory()',
            '    x.greet()',
            '',
        ].join('\n');
        const fp = 'src/factory.py';
        const { rawCalls, symbolTable, importMap, returnTypes } = await prepare('python', code, fp);

        const greetCall = rawCalls.find((c) => c.callName === 'greet');
        expect(greetCall?.receiverType).toBe('@CALLEE:factory');

        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), symbolTable, importMap, returnTypes);
        const greetEdge = callEdges.find((e) => e.callName === 'greet');
        expect(greetEdge).toBeDefined();
        expect(greetEdge?.target).toContain('User.greet');
        expect(stats.receiver).toBeGreaterThanOrEqual(1);
    });

    it('Kotlin: `val x = factory()` resolves outer call via factory return type', async () => {
        const code = [
            'class User { fun greet(): String = "" }',
            'fun factory(): User = User()',
            'fun run() {',
            '    val x = factory()',
            '    x.greet()',
            '}',
        ].join('\n');
        const fp = 'src/factory.kt';
        const { rawCalls, symbolTable, importMap, returnTypes } = await prepare('kotlin', code, fp);

        const greetCall = rawCalls.find((c) => c.callName === 'greet');
        expect(greetCall?.receiverType).toBe('@CALLEE:factory');

        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), symbolTable, importMap, returnTypes);
        const greetEdge = callEdges.find((e) => e.callName === 'greet');
        expect(greetEdge).toBeDefined();
        expect(greetEdge?.target).toContain('User.greet');
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

    it('cross-file value binding: `import { db }; db.query()` resolves via source-file valueBindings', async () => {
        // Receiver is an unbound lowercase identifier — extractor records
        // `@IMPORT:db`. Resolver consults importMap → 'src/services.ts' →
        // valueBindings.get('src/services.ts').get('db') = 'Database'.
        const calls: RawCallSite[] = [
            { source: 'src/users.ts', callName: 'query', line: 5, column: 5, receiverType: '@IMPORT:db' },
        ];
        const symbolTable = createSymbolTable();
        symbolTable.add('src/db.ts', 'query', 'src/db.ts::Database.query');
        const importMap = createImportMap();
        importMap.add('src/users.ts', 'db', 'src/services.ts');
        const valueBindings = new Map<string, Map<string, string>>([
            ['src/services.ts', new Map([['db', 'Database']])],
        ]);

        const { callEdges, stats } = resolveAllCalls(
            calls,
            new Map(),
            symbolTable,
            importMap,
            new Map(),
            new Map(),
            valueBindings,
        );
        expect(callEdges).toHaveLength(1);
        expect(callEdges[0].target).toBe('src/db.ts::Database.query');
        expect(callEdges[0].confidence).toBe(0.95);
        expect(stats.receiver).toBe(1);
    });

    it('cross-file value binding: source-file `@CALLEE:` chain resolves transitively', async () => {
        // Source file declares `export const db = createDb();` — extractor
        // recorded `db -> @CALLEE:createDb`. Caller imports db. Resolver
        // follows the chain: @IMPORT:db → @CALLEE:createDb (in source ctx) →
        // createDb's return type = 'Database'.
        const calls: RawCallSite[] = [
            { source: 'src/users.ts', callName: 'query', line: 5, column: 5, receiverType: '@IMPORT:db' },
        ];
        const symbolTable = createSymbolTable();
        symbolTable.add('src/services.ts', 'createDb', 'src/services.ts::createDb');
        symbolTable.add('src/db.ts', 'query', 'src/db.ts::Database.query');
        const importMap = createImportMap();
        importMap.add('src/users.ts', 'db', 'src/services.ts');
        const valueBindings = new Map<string, Map<string, string>>([
            ['src/services.ts', new Map([['db', '@CALLEE:createDb']])],
        ]);
        const returnTypes = new Map<string, string>([['src/services.ts::createDb', 'Database']]);

        const { callEdges } = resolveAllCalls(
            calls,
            new Map(),
            symbolTable,
            importMap,
            returnTypes,
            new Map(),
            valueBindings,
        );
        expect(callEdges).toHaveLength(1);
        expect(callEdges[0].target).toBe('src/db.ts::Database.query');
    });

    it('cross-file value binding: gracefully falls through when receiver not imported', async () => {
        const calls: RawCallSite[] = [
            { source: 'src/users.ts', callName: 'query', line: 5, column: 5, receiverType: '@IMPORT:notImported' },
        ];
        const symbolTable = createSymbolTable();
        const importMap = createImportMap();
        // No import recorded for `notImported` — should fall through.
        const { callEdges, stats } = resolveAllCalls(
            calls,
            new Map(),
            symbolTable,
            importMap,
            new Map(),
            new Map(),
            new Map(),
        );
        expect(callEdges).toHaveLength(0);
        expect(stats.receiver).toBe(0);
    });

    it('TS end-to-end: extractor emits valueBindings + @IMPORT marker, resolver substitutes', async () => {
        // Same-file end-to-end: extractor's collectBindings includes `db: Database`
        // at file scope. The receiver-type extractor sees `db.query()` and emits
        // `@IMPORT:db` (because `db` isn't in any function-scope bindings — it IS
        // in fileBindings, but the test here exercises the receiver-tier deferred
        // path where db comes from another module).
        //
        // Scenario: services.ts exports a Database const; users.ts imports it.
        // We simulate by manually constructing valueBindings + importMap.
        const usersCode = ['function run() {', '    db.query();', '}'].join('\n');
        const fp = 'src/users.ts';
        const { rawCalls, symbolTable } = await prepare('TypeScript', usersCode, fp);

        const queryCall = rawCalls.find((c) => c.callName === 'query');
        expect(queryCall).toBeDefined();
        // The unbound lowercase identifier `db` triggers the @IMPORT marker.
        expect(queryCall?.receiverType).toBe('@IMPORT:db');

        // Wire up a synthetic resolution context as if services.ts had been
        // parsed alongside this file and contributed the db binding.
        symbolTable.add('src/db.ts', 'query', 'src/db.ts::Database.query');
        const importMap = createImportMap();
        importMap.add(fp, 'db', 'src/services.ts');
        const valueBindings = new Map<string, Map<string, string>>([
            ['src/services.ts', new Map([['db', 'Database']])],
        ]);

        const { callEdges, stats } = resolveAllCalls(
            rawCalls,
            new Map(),
            symbolTable,
            importMap,
            new Map(),
            new Map(),
            valueBindings,
        );
        const queryEdge = callEdges.find((e) => e.callName === 'query');
        expect(queryEdge).toBeDefined();
        expect(queryEdge?.target).toBe('src/db.ts::Database.query');
        expect(queryEdge?.confidence).toBe(0.95);
        expect(stats.receiver).toBe(1);
    });

    it('Kotlin extension function `fun Foo.bar()` indexed as Foo.bar — caller resolves at receiver tier', async () => {
        // `fun Foo.bar(): X` is syntactically top-level but semantically a
        // method on Foo. Without the extension-receiver fix, kotlinx-style
        // codebases lose every extension call to ambiguous tier.
        const code = [
            'class Foo',
            'fun Foo.bar(): String = "hi"',
            'fun run() {',
            '    val foo = Foo()',
            '    foo.bar()',
            '}',
        ].join('\n');
        const fp = 'src/ext.kt';
        const { rawCalls, symbolTable, importMap, returnTypes, functions } = await prepare('kotlin', code, fp);

        // Extractor: `bar` is registered with className=Foo, so its qualified
        // name is `<fp>::Foo.bar` (not `<fp>::bar`).
        const barFn = functions.find((f) => f.name === 'bar');
        expect(barFn).toBeDefined();
        expect(barFn!.qualified).toBe('src/ext.kt::Foo.bar');

        const barCall = rawCalls.find((c) => c.callName === 'bar');
        expect(barCall?.receiverType).toBe('Foo');

        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), symbolTable, importMap, returnTypes);
        const barEdge = callEdges.find((e) => e.callName === 'bar');
        expect(barEdge).toBeDefined();
        expect(barEdge?.target).toBe('src/ext.kt::Foo.bar');
        expect(barEdge?.confidence).toBeGreaterThanOrEqual(0.9);
        expect(stats.receiver).toBeGreaterThanOrEqual(1);
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
