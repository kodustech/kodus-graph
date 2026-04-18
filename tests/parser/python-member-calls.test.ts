// tests/parser/python-member-calls.test.ts
//
// Phase 3.5 Task 3: Python member-call extraction.
//
// The shared `$CALLEE($$$ARGS)` pattern already matches Python `x.method(args)`
// because the Python tree-sitter grammar exposes the whole `x.method` as the
// callee. These assertions guard that behavior and document the known limit
// that Python's receiver-type inference is still a no-op (per Phase 3 Task 2),
// so `x.method()` falls through to the name-based cascade rather than the
// 0.95-confidence receiver tier.
import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
import '../../src/parser/languages';
import '../../src/languages/python';
import { extractCallsFromFile } from '../../src/parser/extractor';

describe('Python member-call extraction', () => {
    async function extract(src: string, fp: string = 'src/a.py'): Promise<RawCallSite[]> {
        const root = await parseAsync('python' as never, src);
        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'python', calls);
        return calls;
    }

    it('captures `x.method(args)` with the method name as callName', async () => {
        const src = 'def r():\n    x = Foo()\n    x.doWork(42)\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('doWork');
    });

    it('still captures bare `func(args)` calls', async () => {
        const src = 'def r():\n    bare_helper(1)\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('bare_helper');
    });

    it('records `self.method()` as a self call with resolveInClass', async () => {
        const src = 'class Caller:\n    def run(self):\n        self.helper()\n    def helper(self):\n        pass\n';
        const calls = await extract(src);
        const helperCall = calls.find((c) => c.callName === 'helper');
        expect(helperCall).toBeDefined();
        expect(helperCall!.resolveInClass).toBe('Caller');
    });

    it('exposes column so receiver-type inference can key call sites', async () => {
        const src = 'def r():\n    x = Foo()\n    x.doWork()\n';
        const calls = await extract(src);
        const c = calls.find((x) => x.callName === 'doWork');
        expect(c).toBeDefined();
        expect(typeof c!.column).toBe('number');
    });
});
