import { describe, expect, it } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
// Required for noise routing and registering the TypeScript receiver-type extractor.
import '../../src/languages/typescript';
import { extractReceiverTypesFromEngine } from '../../src/languages/engine';
import { locationKey } from '../../src/languages/receiver-types';
import { extractCallsFromFile } from '../../src/parser/extractor';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable, type SymbolTable } from '../../src/resolver/symbol-table';

function seedDefinitions(table: SymbolTable, qualifiedNames: string[]): void {
    for (const q of qualifiedNames) {
        const [file, symbol] = q.includes('::') ? q.split('::') : [q, q];
        const name = symbol.includes('.') ? symbol.split('.').pop()! : symbol;
        table.add(file, name, q);
    }
}

describe('receiver-type-aware resolution', () => {
    it('resolves x.update() to Foo.update when receiverType is Foo (0.95, unique)', () => {
        const table = createSymbolTable();
        seedDefinitions(table, ['src/foo.ts::Foo.update', 'src/bar.ts::Bar.update']);
        const rawCalls: RawCallSite[] = [
            { source: 'src/caller.ts', callName: 'update', line: 10, receiverType: 'Foo' },
        ];
        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.receiver).toBe(1);
        expect(callEdges.length).toBe(1);
        expect(callEdges[0].target).toBe('src/foo.ts::Foo.update');
        expect(callEdges[0].confidence).toBe(0.95);
        expect(callEdges[0].alternatives).toBeUndefined();
    });

    it('emits 0.90 + alternatives when receiverType matches the same class in multiple files', () => {
        const table = createSymbolTable();
        seedDefinitions(table, ['src/a/Foo.ts::Foo.update', 'src/b/Foo.ts::Foo.update']);
        const rawCalls: RawCallSite[] = [
            { source: 'src/a/caller.ts', callName: 'update', line: 1, receiverType: 'Foo' },
        ];
        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.receiver).toBe(1);
        expect(callEdges[0].confidence).toBe(0.9);
        expect(callEdges[0].target).toBe('src/a/Foo.ts::Foo.update');
        expect(callEdges[0].alternatives).toBeDefined();
        expect(callEdges[0].alternatives!.length).toBe(1);
        expect(callEdges[0].alternatives![0]).toBe('src/b/Foo.ts::Foo.update');
    });

    it('falls through to same-file tier (0.85) when receiverType has no matching ::Type.method', () => {
        const table = createSymbolTable();
        table.add('src/caller.ts', 'helper', 'src/caller.ts::helper');
        const rawCalls: RawCallSite[] = [
            { source: 'src/caller.ts', callName: 'helper', line: 1, receiverType: 'NonexistentType' },
        ];
        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.receiver).toBe(0);
        expect(callEdges[0].confidence).toBe(0.85);
        expect(callEdges[0].target).toBe('src/caller.ts::helper');
    });

    it('is a no-op when receiverType is absent (Phase 2 behavior preserved)', () => {
        const table = createSymbolTable();
        table.add('src/caller.ts', 'helper', 'src/caller.ts::helper');
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'helper', line: 1 }];
        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.receiver).toBe(0);
        expect(callEdges[0].confidence).toBe(0.85);
    });
});

describe('receiver-type-aware resolution (TypeScript integration)', () => {
    it('infers receiverType from `const x = new Foo()` and resolves x.update() to Foo.update at 0.95', async () => {
        const source = `class Caller {
    run(): void {
        const x = new Foo();
        x.update();
    }
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const fp = 'src/caller.ts';

        // Extract calls (column threaded through by shared extractCalls).
        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'TypeScript', calls);

        // Run receiver-type inference and cross-wire.
        const receiverMap = extractReceiverTypesFromEngine(root, fp, 'TypeScript');
        for (const call of calls) {
            const rt = receiverMap.get(locationKey(fp, call.line, call.column ?? -1));
            if (rt) {
                call.receiverType = rt;
            }
        }

        // Find the x.update() call specifically.
        const updateCall = calls.find((c) => c.callName === 'update');
        expect(updateCall).toBeDefined();
        expect(updateCall!.receiverType).toBe('Foo');

        // Resolve through the full cascade with two Foo.update definitions in unrelated files.
        const table = createSymbolTable();
        table.add('src/foo.ts', 'update', 'src/foo.ts::Foo.update');
        table.add('src/bar.ts', 'update', 'src/bar.ts::Bar.update');
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap());
        const resolvedUpdate = callEdges.find((e) => e.callName === 'update');
        expect(resolvedUpdate).toBeDefined();
        expect(resolvedUpdate!.confidence).toBe(0.95);
        expect(resolvedUpdate!.target).toBe('src/foo.ts::Foo.update');
        expect(stats.receiver).toBe(1);
    });

    it('infers receiverType from explicit type annotation `let y: Bar = ...`', async () => {
        const source = `function go() {
    let y: Bar = makeBar();
    y.run();
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const fp = 'src/a.ts';
        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'TypeScript', calls);
        const receiverMap = extractReceiverTypesFromEngine(root, fp, 'TypeScript');
        for (const call of calls) {
            const rt = receiverMap.get(locationKey(fp, call.line, call.column ?? -1));
            if (rt) {
                call.receiverType = rt;
            }
        }
        const runCall = calls.find((c) => c.callName === 'run');
        expect(runCall?.receiverType).toBe('Bar');
    });
});
