// tests/parser/dart-member-calls.test.ts
//
// Phase 3.5 Task 3: Dart call extraction.
//
// Dart's ast-grep grammar rejects the shared `$CALLEE($$$ARGS)` pattern with
// "Multiple AST nodes are detected" because `x.update(42)` decomposes into
// sibling `identifier` + `selector[.update]` + `selector[(42)]` children of
// the enclosing expression. Before this task, Dart call extraction crashed
// on any input and no RawCallSites were produced. These assertions lock in
// the walk-based replacement.
import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
import '../../src/parser/languages';
import '../../src/languages/dart';
import { extractCallsFromFile } from '../../src/parser/extractor';

describe('Dart call extraction (bare + member)', () => {
    async function extract(src: string, fp: string = 'src/a.dart'): Promise<RawCallSite[]> {
        const root = await parseAsync('dart' as never, src);
        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'dart', calls);
        return calls;
    }

    it('captures bare `func(args)` calls', async () => {
        const src = 'class A {\n    void r() {\n        bareHelper(1);\n    }\n}\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('bareHelper');
    });

    it('captures `x.method(args)` as callName = method', async () => {
        const src = 'class A {\n    void r(Foo x) {\n        x.doWork(42);\n    }\n}\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('doWork');
    });

    it('captures chained calls like `x.a().b()` as two separate method names', async () => {
        const src = 'class A {\n    void r(Foo x) {\n        x.doFirst().doSecond();\n    }\n}\n';
        const calls = await extract(src);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('doFirst');
        expect(names).toContain('doSecond');
    });

    it('records `this.method()` with resolveInClass = current class', async () => {
        const src = 'class Caller {\n    void r() {\n        this.helper();\n    }\n    void helper() {}\n}\n';
        const calls = await extract(src);
        const helperCall = calls.find((c) => c.callName === 'helper');
        expect(helperCall).toBeDefined();
        expect(helperCall!.resolveInClass).toBe('Caller');
    });

    it('records `super.method()` with resolveInClass = parent class', async () => {
        const src = 'class Child extends Parent {\n    void r() {\n        super.helper();\n    }\n}\n';
        const calls = await extract(src);
        const helperCall = calls.find((c) => c.callName === 'helper');
        expect(helperCall).toBeDefined();
        expect(helperCall!.resolveInClass).toBe('Parent');
    });

    it('exposes column for receiver-type keying', async () => {
        const src = 'class A {\n    void r(Svc s) {\n        s.doWork();\n    }\n}\n';
        const calls = await extract(src);
        const c = calls.find((x) => x.callName === 'doWork');
        expect(c).toBeDefined();
        expect(typeof c!.column).toBe('number');
    });
});
