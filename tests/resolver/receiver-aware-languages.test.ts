import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
import { extractReceiverTypesFromEngine } from '../../src/languages/engine';
import { locationKey } from '../../src/languages/receiver-types';
// Importing the barrel registers each language's extractor + receiver-type hook.
import '../../src/parser/languages';
import '../../src/languages/csharp';
import '../../src/languages/dart';
import '../../src/languages/elixir';
import '../../src/languages/go';
import '../../src/languages/java';
import '../../src/languages/kotlin';
import '../../src/languages/php';
import '../../src/languages/python';
import '../../src/languages/ruby';
import '../../src/languages/rust';
import '../../src/languages/scala';
import '../../src/languages/swift';
import '../../src/languages/c';
import { extractCallsFromFile } from '../../src/parser/extractor';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';

async function extractWithReceiver(lang: string, source: string, fp: string): Promise<RawCallSite[]> {
    const root = await parseAsync(lang as never, source);
    const calls: RawCallSite[] = [];
    extractCallsFromFile(root, fp, lang, calls);
    const map = extractReceiverTypesFromEngine(root, fp, lang);
    for (const call of calls) {
        const rt = map.get(locationKey(fp, call.line, call.column ?? -1));
        if (rt) {
            call.receiverType = rt;
        }
    }
    return calls;
}

describe('receiver-type inference per language', () => {
    it('Java infers receiverType from `Foo x = new Foo()`', async () => {
        const calls = await extractWithReceiver(
            'java',
            'class A { void r() { Foo x = new Foo(); x.doWork(); } }',
            'src/A.java',
        );
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('C# infers receiverType from `Foo x = new Foo()`', async () => {
        const calls = await extractWithReceiver(
            'csharp',
            'class A { void R() { Foo x = new Foo(); x.Update(); } }',
            'src/A.cs',
        );
        const upd = calls.find((c) => c.callName === 'Update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Kotlin infers receiverType from `val x = Foo()`', async () => {
        const calls = await extractWithReceiver(
            'kotlin',
            'class A { fun r() { val x = Foo(); x.update() } }',
            'src/a.kt',
        );
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Rust infers receiverType from `let x = Foo::new()`', async () => {
        const calls = await extractWithReceiver('rust', 'fn r() { let x = Foo::new(); x.update(); }', 'src/a.rs');
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Scala infers receiverType from `val x = new Foo()`', async () => {
        const calls = await extractWithReceiver(
            'scala',
            'class A { def r(): Unit = { val x = new Foo(); x.update() } }',
            'src/A.scala',
        );
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Swift infers receiverType from `let x = Foo()`', async () => {
        const calls = await extractWithReceiver(
            'swift',
            'class A { func r() { let x = Foo(); x.update() } }',
            'src/A.swift',
        );
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Go infers receiverType from factory `x := NewFoo()`', async () => {
        const calls = await extractWithReceiver(
            'go',
            'package main\nfunc r() { x := NewFoo(); x.Update() }',
            'src/a.go',
        );
        const upd = calls.find((c) => c.callName === 'Update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('C++ infers receiverType from `Foo x;`', async () => {
        const calls = await extractWithReceiver('cpp', 'void r() { Foo x; x.update(); }', 'src/a.cpp');
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Ruby extractor returns an empty receiver-type map (no-op)', async () => {
        const root = await parseAsync('ruby' as never, 'class A\n  def r\n    x = Foo.new\n    x.update\n  end\nend');
        const map = extractReceiverTypesFromEngine(root, 'src/a.rb', 'ruby');
        expect(map.size).toBe(0);
    });

    it('PHP extractor returns an empty receiver-type map (no-op)', async () => {
        const root = await parseAsync(
            'php' as never,
            '<?php class A { function r() { $x = new Foo(); $x->update(); } }',
        );
        const map = extractReceiverTypesFromEngine(root, 'src/a.php', 'php');
        expect(map.size).toBe(0);
    });

    it('Elixir extractor returns an empty receiver-type map (no-op)', async () => {
        const root = await parseAsync('elixir' as never, 'defmodule A do\n  def r, do: Foo.update()\nend');
        const map = extractReceiverTypesFromEngine(root, 'src/a.ex', 'elixir');
        expect(map.size).toBe(0);
    });

    it('Dart infers receiverType from `Foo x = Foo()`', async () => {
        const calls = await extractWithReceiver(
            'dart',
            'class A { void r() { Foo x = Foo(); x.doWork(); } }',
            'src/a.dart',
        );
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Python infers receiverType from `x = Foo()` (uppercase constructor)', async () => {
        const calls = await extractWithReceiver('python', 'def r():\n    x = Foo()\n    x.doWork()\n', 'src/a.py');
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Python infers receiverType from type-annotated variable `x: Foo = ...`', async () => {
        const calls = await extractWithReceiver(
            'python',
            'def r():\n    x: Foo = make()\n    x.doWork()\n',
            'src/a.py',
        );
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Python infers receiverType from type-annotated parameter `svc: Foo`', async () => {
        const calls = await extractWithReceiver('python', 'def r(svc: Foo):\n    svc.doWork()\n', 'src/a.py');
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Python does NOT bind `x = helper()` when callee starts lowercase', async () => {
        const calls = await extractWithReceiver('python', 'def r():\n    x = helper()\n    x.doWork()\n', 'src/a.py');
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// End-to-end: resolver confidence for Java/Dart/Python member calls.
// Exercises the same cascade as receiver-aware.test.ts but for the three
// languages that just gained member-call extraction.
// ---------------------------------------------------------------------------

describe('receiver-type resolver cascade (Java/Dart/Python)', () => {
    it('Java `x.doWork()` resolves to Foo.doWork at 0.95 when receiverType is Foo', async () => {
        const src = 'class Caller { void run() { Foo x = new Foo(); x.doWork(); } }';
        const calls = await extractWithReceiver('java', src, 'src/Caller.java');
        const doWorkCall = calls.find((c) => c.callName === 'doWork');
        expect(doWorkCall?.receiverType).toBe('Foo');

        const table = createSymbolTable();
        table.add('src/Foo.java', 'doWork', 'src/Foo.java::Foo.doWork');
        table.add('src/Bar.java', 'doWork', 'src/Bar.java::Bar.doWork');
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap());
        const resolved = callEdges.find((e) => e.callName === 'doWork');
        expect(resolved).toBeDefined();
        expect(resolved!.confidence).toBe(0.95);
        expect(resolved!.target).toBe('src/Foo.java::Foo.doWork');
        expect(stats.receiver).toBe(1);
    });

    it('Dart `x.doWork()` resolves to Foo.doWork at 0.95 when receiverType is Foo', async () => {
        const src = 'class Caller { void run() { Foo x = Foo(); x.doWork(); } }';
        const calls = await extractWithReceiver('dart', src, 'src/caller.dart');
        const doWorkCall = calls.find((c) => c.callName === 'doWork');
        expect(doWorkCall?.receiverType).toBe('Foo');

        const table = createSymbolTable();
        table.add('src/foo.dart', 'doWork', 'src/foo.dart::Foo.doWork');
        table.add('src/bar.dart', 'doWork', 'src/bar.dart::Bar.doWork');
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap());
        const resolved = callEdges.find((e) => e.callName === 'doWork');
        expect(resolved).toBeDefined();
        expect(resolved!.confidence).toBe(0.95);
        expect(resolved!.target).toBe('src/foo.dart::Foo.doWork');
        expect(stats.receiver).toBe(1);
    });

    it('Python `x.doWork()` resolves to Foo.doWork at 0.95 when receiverType is Foo', async () => {
        const src = 'def run():\n    x = Foo()\n    x.doWork()\n';
        const calls = await extractWithReceiver('python', src, 'src/a.py');
        const doWorkCall = calls.find((c) => c.callName === 'doWork');
        expect(doWorkCall?.receiverType).toBe('Foo');

        const table = createSymbolTable();
        table.add('src/foo.py', 'doWork', 'src/foo.py::Foo.doWork');
        table.add('src/bar.py', 'doWork', 'src/bar.py::Bar.doWork');
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap());
        const resolved = callEdges.find((e) => e.callName === 'doWork');
        expect(resolved).toBeDefined();
        expect(resolved!.confidence).toBe(0.95);
        expect(resolved!.target).toBe('src/foo.py::Foo.doWork');
        expect(stats.receiver).toBe(1);
    });

    it('Python: type-annotated parameter carries receiver type to 0.95 tier', async () => {
        const src = 'def persist(s: Storage):\n    s.save(42)\n';
        const calls = await extractWithReceiver('python', src, 'src/a.py');
        const saveCall = calls.find((c) => c.callName === 'save');
        expect(saveCall?.receiverType).toBe('Storage');

        const table = createSymbolTable();
        table.add('src/storage.py', 'save', 'src/storage.py::Storage.save');
        table.add('src/other.py', 'save', 'src/other.py::Other.save');
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap());
        const resolved = callEdges.find((e) => e.callName === 'save');
        expect(resolved).toBeDefined();
        expect(resolved!.confidence).toBe(0.95);
        expect(resolved!.target).toBe('src/storage.py::Storage.save');
        expect(stats.receiver).toBe(1);
    });
});
