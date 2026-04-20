import { describe, expect, it } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
// Register language extractors + noise lists for TS and Python.
import '../../src/languages/python';
import '../../src/languages/typescript';
import { extractReceiverTypesFromEngine } from '../../src/languages/engine';
import { locationKey } from '../../src/languages/receiver-types';
import { extractCallsFromFile } from '../../src/parser/extractor';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';

/**
 * End-to-end regression for FIX #1: noise filter must NOT run at extraction
 * time. With the old behavior, the call `x.forEach(...)` (TS noise) and
 * `svc.update(...)` (Python noise) were dropped at extraction before
 * `receiverType` was ever attached. They never reached the resolver's
 * receiver tier, killing 0.95 resolution for user-domain methods that happen
 * to share a name with stdlib/framework builtins.
 *
 * After the fix, extraction keeps the call; the resolver's receiver tier
 * fires first and resolves to the user-defined type, only falling through
 * to noise when there's no symbol-table match.
 */
describe('noise names bypass noise filter when receiverType has symbol-table match', () => {
    it('TS: x.forEach() resolves to Foo.forEach when x: Foo is inferred and Foo.forEach exists', async () => {
        const source = `class Foo {
    forEach(cb: (x: number) => void): void {
        cb(1);
    }
}
function run(): void {
    const f = new Foo();
    f.forEach((x) => {
        console.log(x);
    });
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const fp = 'demo.ts';

        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'TypeScript', calls);

        // Wire receiver types onto calls (what parseBatch does for real files).
        const receiverMap = extractReceiverTypesFromEngine(root, fp, 'TypeScript');
        for (const call of calls) {
            const rt = receiverMap.get(locationKey(fp, call.line, call.column ?? -1));
            if (rt) {
                call.receiverType = rt;
            }
        }

        // Seed Foo.forEach as a user-defined method in the symbol table.
        const st = createSymbolTable();
        st.add(fp, 'forEach', `${fp}::Foo.forEach`);

        const { callEdges, stats } = resolveAllCalls(calls, new Map(), st, createImportMap());

        // BEFORE fix: `forEach` is in TS noise, dropped at extraction, edge never existed.
        // AFTER fix: receiver tier hits, emits 0.95 edge to Foo.forEach.
        const forEachEdge = callEdges.find((e) => e.callName === 'forEach');
        expect(forEachEdge).toBeDefined();
        expect(forEachEdge!.target).toBe(`${fp}::Foo.forEach`);
        expect(forEachEdge!.confidence).toBe(0.95);
        expect(stats.receiver).toBeGreaterThanOrEqual(1);
    });

    it('Python: svc.update() resolves to UserService.update when svc: UserService and UserService.update exists', async () => {
        const source = `class UserService:
    def update(self, payload):
        return payload

def run():
    svc: UserService = UserService()
    svc.update({"x": 1})
`;
        const root = await parseAsync('python' as unknown as Lang, source);
        const fp = 'demo.py';

        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'python', calls);

        const receiverMap = extractReceiverTypesFromEngine(root, fp, 'python');
        for (const call of calls) {
            const rt = receiverMap.get(locationKey(fp, call.line, call.column ?? -1));
            if (rt) {
                call.receiverType = rt;
            }
        }

        const st = createSymbolTable();
        st.add(fp, 'update', `${fp}::UserService.update`);

        const { callEdges, stats } = resolveAllCalls(calls, new Map(), st, createImportMap());

        const updateEdge = callEdges.find((e) => e.callName === 'update');
        expect(updateEdge).toBeDefined();
        expect(updateEdge!.target).toBe(`${fp}::UserService.update`);
        expect(updateEdge!.confidence).toBe(0.95);
        expect(stats.receiver).toBeGreaterThanOrEqual(1);
    });
});
