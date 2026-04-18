import { describe, expect, it } from 'bun:test';
import type { RawCallSite } from '../../src/graph/types';
// Side-effect imports populate the per-language noise registry.
import '../../src/languages/ruby';
import '../../src/languages/typescript';
import { resolveAllCalls, resolveCall } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';

describe('call-resolver noise routing by language', () => {
    it('treats `log` in a .ts file as noise', () => {
        const st = createSymbolTable();
        const im = createImportMap();
        const diMaps = new Map<string, Map<string, string>>();

        const rawCalls: RawCallSite[] = [{ source: 'src/app.ts', callName: 'log', line: 1 }];

        const { callEdges, stats } = resolveAllCalls(rawCalls, diMaps, st, im);
        expect(callEdges).toHaveLength(0);
        expect(stats.noise).toBe(1);
    });

    it('does NOT treat `update` in a .rb file as noise (not in Ruby noise set)', () => {
        const st = createSymbolTable();
        // Seed a same-file target so it resolves cleanly, not just drops.
        st.add('app/models/user.rb', 'update', 'app/models/user.rb::User.update');
        const im = createImportMap();
        const diMaps = new Map<string, Map<string, string>>();

        const rawCalls: RawCallSite[] = [{ source: 'app/models/user.rb', callName: 'update', line: 10 }];

        const { callEdges, stats } = resolveAllCalls(rawCalls, diMaps, st, im);
        expect(stats.noise).toBe(0);
        expect(callEdges).toHaveLength(1);
    });

    it('treats `puts` in a .rb file as noise', () => {
        const st = createSymbolTable();
        const im = createImportMap();
        const diMaps = new Map<string, Map<string, string>>();

        const rawCalls: RawCallSite[] = [{ source: 'app/models/user.rb', callName: 'puts', line: 1 }];

        const { callEdges, stats } = resolveAllCalls(rawCalls, diMaps, st, im);
        expect(callEdges).toHaveLength(0);
        expect(stats.noise).toBe(1);
    });

    it('does NOT treat `print` in a .ts file as noise (print is Python-only)', () => {
        const st = createSymbolTable();
        st.add('src/app.ts', 'print', 'src/app.ts::print');
        const im = createImportMap();
        const diMaps = new Map<string, Map<string, string>>();

        const rawCalls: RawCallSite[] = [{ source: 'src/app.ts', callName: 'print', line: 3 }];

        const { callEdges, stats } = resolveAllCalls(rawCalls, diMaps, st, im);
        expect(stats.noise).toBe(0);
        expect(callEdges).toHaveLength(1);
    });

    it('resolveCall wrapper routes noise by file language', () => {
        const st = createSymbolTable();
        const im = createImportMap();

        // `log` in a .ts file → dropped as TS noise
        expect(resolveCall('log', 'src/app.ts', st, im)).toBeNull();

        // `puts` in a .ts file → NOT TS noise; falls through to unresolved → null
        //   but it isn't filtered at the noise stage.
        //   Seed the symbol table so it resolves — that proves the noise gate didn't fire.
        st.add('src/app.ts', 'puts', 'src/app.ts::puts');
        const result = resolveCall('puts', 'src/app.ts', st, im);
        expect(result).not.toBeNull();
    });
});
