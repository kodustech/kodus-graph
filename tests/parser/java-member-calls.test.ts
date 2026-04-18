// tests/parser/java-member-calls.test.ts
//
// Phase 3.5 Task 3: Java member-call extraction.
//
// The shared `$CALLEE($$$ARGS)` ast-grep pattern only matches bare Java calls
// (e.g. `bare()`); it doesn't bind to `method_invocation` nodes that have an
// `object` field (e.g. `x.update(42)`). These assertions lock in the walk-based
// fallback that captures member invocations with the correct method name.
import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
import '../../src/parser/languages';
import '../../src/languages/java';
import { extractCallsFromFile } from '../../src/parser/extractor';

describe('Java member-call extraction', () => {
    async function extract(src: string, fp: string = 'src/A.java'): Promise<RawCallSite[]> {
        const root = await parseAsync('java' as never, src);
        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'java', calls);
        return calls;
    }

    it('captures `x.method(args)` with the method name as callName', async () => {
        const src = 'class Caller {\n    void run(UserService svc) {\n        svc.doWork(42);\n    }\n}\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('doWork');
    });

    it('still captures bare `method(args)` calls', async () => {
        const src = 'class Caller {\n    void run() {\n        bareHelper(1);\n    }\n}\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('bareHelper');
    });

    it('captures both bare and member calls in the same method', async () => {
        const src =
            'class Caller {\n    void run(UserService svc) {\n        bareHelper(1);\n        svc.doWork(42);\n    }\n}\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('bareHelper');
        expect(names).toContain('doWork');
    });

    it('records `this.method()` as a self call with resolveInClass', async () => {
        const src = 'class Caller {\n    void run() {\n        this.helper();\n    }\n    void helper() {}\n}\n';
        const calls = await extract(src);
        const helperCall = calls.find((c) => c.callName === 'helper');
        expect(helperCall).toBeDefined();
        expect(helperCall!.resolveInClass).toBe('Caller');
    });

    it('records `super.method()` with the parent class as resolveInClass', async () => {
        const src = 'class Child extends Parent {\n    void run() {\n        super.helper();\n    }\n}\n';
        const calls = await extract(src);
        const helperCall = calls.find((c) => c.callName === 'helper');
        expect(helperCall).toBeDefined();
        expect(helperCall!.resolveInClass).toBe('Parent');
    });

    it('exposes column so receiver-type inference can key call sites', async () => {
        const src = 'class Caller {\n    void run(Svc s) {\n        s.doWork();\n    }\n}\n';
        const calls = await extract(src);
        const c = calls.find((x) => x.callName === 'doWork');
        expect(c).toBeDefined();
        expect(typeof c!.column).toBe('number');
    });
});
