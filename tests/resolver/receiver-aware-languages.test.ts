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

    it('Java ctor param type seeds receiver-type inside class body', async () => {
        const calls = await extractWithReceiver(
            'java',
            [
                '@Service',
                'class UserService {',
                '    private final UserRepository repo;',
                '    public UserService(UserRepository repo) { this.repo = repo; }',
                '    public void list() { repo.findAll(); }',
                '}',
            ].join('\n'),
            'src/UserService.java',
        );
        const findAll = calls.find((c) => c.callName === 'findAll');
        expect(findAll?.receiverType).toBe('UserRepository');
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

    it('PHP infers receiverType from `$x = new Foo()`', async () => {
        const calls = await extractWithReceiver(
            'php',
            '<?php class A { function r() { $x = new Foo(); $x->update(); } }',
            'src/a.php',
        );
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Elixir extractor returns an empty receiver-type map (no-op)', async () => {
        const root = await parseAsync('elixir' as never, 'defmodule A do\n  def r, do: Foo.update()\nend');
        const map = extractReceiverTypesFromEngine(root, 'src/a.ex', 'elixir');
        expect(map.size).toBe(0);
    });

    it('C infers receiverType through pointer declarator `Foo *x = ...; x->method()`', async () => {
        const calls = await extractWithReceiver('c', 'void r() { Foo *x = make_foo(); x->update(); }', 'src/a.c');
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('C++ infers receiverType through reference declarator `Foo &x = ...; x.method()`', async () => {
        const calls = await extractWithReceiver('cpp', 'void r(Foo& src) { Foo &x = src; x.update(); }', 'src/a.cpp');
        const upd = calls.find((c) => c.callName === 'update');
        expect(upd?.receiverType).toBe('Foo');
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

    it('Python unwraps List[Foo] to Foo for receiverType', async () => {
        const calls = await extractWithReceiver(
            'python',
            'from typing import List\ndef r(items: List[Foo]):\n    items[0].doWork()\n    items.doWork()\n',
            'src/a.py',
        );
        // The bare `items.doWork()` should pick up Foo via the unwrap path.
        const upd = calls.find((c) => c.callName === 'doWork' && c.receiverType === 'Foo');
        expect(upd).toBeDefined();
    });

    it('Python unwraps Dict[str, Foo] to Foo (value type wins)', async () => {
        const calls = await extractWithReceiver(
            'python',
            'from typing import Dict\ndef r(reg: Dict[str, Foo]):\n    reg.doWork()\n',
            'src/a.py',
        );
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Python factory method __post_init__ binds self.attr', async () => {
        const calls = await extractWithReceiver(
            'python',
            'from dataclasses import dataclass\n@dataclass\nclass Svc:\n    def __post_init__(self):\n        self.repo = Repo()\n    def run(self):\n        self.repo.find()\n',
            'src/svc.py',
        );
        const upd = calls.find((c) => c.callName === 'find');
        expect(upd?.receiverType).toBe('Repo');
    });

    it('Python factory method setUp binds self.attr (unittest)', async () => {
        const calls = await extractWithReceiver(
            'python',
            'class Test:\n    def setUp(self):\n        self.svc = Service()\n    def test_x(self):\n        self.svc.run()\n',
            'src/t.py',
        );
        const upd = calls.find((c) => c.callName === 'run');
        expect(upd?.receiverType).toBe('Service');
    });

    it('Python FastAPI Depends() — typed param works regardless of default', async () => {
        const calls = await extractWithReceiver(
            'python',
            'from fastapi import Depends\ndef get_svc():\n    return None\ndef handler(svc: SomeService = Depends(get_svc)):\n    svc.do_work()\n',
            'src/api.py',
        );
        const upd = calls.find((c) => c.callName === 'do_work');
        expect(upd?.receiverType).toBe('SomeService');
    });

    it('Python infers receiverType from type-annotated parameter `svc: Foo`', async () => {
        const calls = await extractWithReceiver('python', 'def r(svc: Foo):\n    svc.doWork()\n', 'src/a.py');
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('Foo');
    });

    it('Python: `x = helper()` (lowercase factory) emits @CALLEE: marker (deferred)', async () => {
        // Behavior change 2026-04-30: lowercase factory calls now record a
        // `@CALLEE:helper` deferred marker so the resolver can substitute the
        // function's actual return type cross-file. The receiver tier falls
        // through gracefully when no return type is recorded.
        const calls = await extractWithReceiver('python', 'def r():\n    x = helper()\n    x.doWork()\n', 'src/a.py');
        const upd = calls.find((c) => c.callName === 'doWork');
        expect(upd?.receiverType).toBe('@CALLEE:helper');
    });

    // ── Cross-language typed-param bindings (#76) ──
    // Each test exercises a function/method whose parameter has an explicit type;
    // a method call on that param inside the body must resolve at the receiver
    // tier. Mirrors the Java ctor-param coverage from #72.

    it('TypeScript: typed parameter `repo: Repo` seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'TypeScript',
            'function handle(repo: Repo) { repo.find(); }',
            'src/h.ts',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('TypeScript: arrow function typed parameter seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'TypeScript',
            'const handle = (repo: Repo) => { repo.find(); };',
            'src/h.ts',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('TypeScript: class method typed parameter seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'TypeScript',
            'class A { handle(repo: Repo): void { repo.find(); } }',
            'src/A.ts',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('Java: regular method typed parameter seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'java',
            'class A { void handle(Repo repo) { repo.find(); } }',
            'src/A.java',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('Kotlin: typed function parameter `repo: Repo` seeds receiverType', async () => {
        const calls = await extractWithReceiver('kotlin', 'fun handle(repo: Repo) { repo.find() }', 'src/h.kt');
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('Go: function parameter `req *Request` seeds receiverType (pointer unwrapped)', async () => {
        const calls = await extractWithReceiver(
            'go',
            'package main\nfunc handle(req *Request) { req.Validate() }',
            'src/h.go',
        );
        const validate = calls.find((c) => c.callName === 'Validate');
        expect(validate?.receiverType).toBe('Request');
    });

    it('Go: method receiver `(s *Server)` seeds receiverType for `s` inside body', async () => {
        const calls = await extractWithReceiver(
            'go',
            'package main\nfunc (s *Server) Handle() { s.Run() }',
            'src/s.go',
        );
        const run = calls.find((c) => c.callName === 'Run');
        expect(run?.receiverType).toBe('Server');
    });

    it('Rust: typed parameter `repo: &Repo` seeds receiverType (reference unwrapped)', async () => {
        const calls = await extractWithReceiver('rust', 'fn handle(repo: &Repo) { repo.find(); }', 'src/h.rs');
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('C#: method typed parameter `Repo repo` seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'csharp',
            'class A { void Handle(Repo repo) { repo.Find(); } }',
            'src/A.cs',
        );
        const find = calls.find((c) => c.callName === 'Find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('C#: bare field access `_repo.Find()` resolves through field binding', async () => {
        // The dominant .NET pattern: ctor-assigned private readonly field,
        // accessed bare without `this.`. Was falling through to cascade
        // before the field-as-binding extension.
        const calls = await extractWithReceiver(
            'csharp',
            [
                'class UserService {',
                '    private readonly IUserRepository _repo;',
                '    public UserService(IUserRepository repo) { _repo = repo; }',
                '    public void List() { _repo.FindAll(); }',
                '}',
            ].join('\n'),
            'src/UserService.cs',
        );
        const findAll = calls.find((c) => c.callName === 'FindAll');
        expect(findAll?.receiverType).toBe('IUserRepository');
    });

    it('C#: auto-property `Repo.Find()` resolves through property binding', async () => {
        const calls = await extractWithReceiver(
            'csharp',
            [
                'class UserPage {',
                '    public IUserRepository Repo { get; set; }',
                '    public void Render() { Repo.FindAll(); }',
                '}',
            ].join('\n'),
            'src/UserPage.cs',
        );
        const findAll = calls.find((c) => c.callName === 'FindAll');
        expect(findAll?.receiverType).toBe('IUserRepository');
    });

    it('C#: primary-constructor param resolves bare inside class body', async () => {
        const calls = await extractWithReceiver(
            'csharp',
            'public class UserService(IUserRepository repo) { public void Run() => repo.FindAll(); }',
            'src/UserService.cs',
        );
        const findAll = calls.find((c) => c.callName === 'FindAll');
        expect(findAll?.receiverType).toBe('IUserRepository');
    });

    it('C#: record primary-constructor param resolves bare inside body', async () => {
        const calls = await extractWithReceiver(
            'csharp',
            'public record UserService(IUserRepository Repo) { public void Run() => Repo.FindAll(); }',
            'src/UserService.cs',
        );
        const findAll = calls.find((c) => c.callName === 'FindAll');
        expect(findAll?.receiverType).toBe('IUserRepository');
    });

    it('Scala: def parameter `repo: Repo` seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'scala',
            'class A { def handle(repo: Repo): Unit = { repo.find() } }',
            'src/A.scala',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('Swift: function parameter `repo: Repo` seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'swift',
            'class A { func handle(repo: Repo) { repo.find() } }',
            'src/A.swift',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('Swift: function parameter with leading `_` external label binds internal name', async () => {
        const calls = await extractWithReceiver(
            'swift',
            'class A { func handle(_ repo: Repo) { repo.find() } }',
            'src/A.swift',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    it('Dart: method parameter `Repo repo` seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'dart',
            'class A { void handle(Repo repo) { repo.find(); } }',
            'src/a.dart',
        );
        const find = calls.find((c) => c.callName === 'find');
        expect(find?.receiverType).toBe('Repo');
    });

    // ── Static method calls (PascalCase receiver = class reference) ──
    // Uses the class name itself as receiverType so the resolver can look up
    // `ClassName.method` directly in the symbol table at the receiver tier.

    it('TypeScript: static call `Logger.warn(...)` seeds receiverType=Logger', async () => {
        const calls = await extractWithReceiver('TypeScript', 'function r() { Logger.warn("hi"); }', 'src/r.ts');
        const warn = calls.find((c) => c.callName === 'warn');
        expect(warn?.receiverType).toBe('Logger');
    });

    it('Java: static call `Math.sqrt(...)` seeds receiverType=Math', async () => {
        const calls = await extractWithReceiver('java', 'class A { void r() { Math.sqrt(2.0); } }', 'src/A.java');
        const sqrt = calls.find((c) => c.callName === 'sqrt');
        expect(sqrt?.receiverType).toBe('Math');
    });

    it('Kotlin: static-style call `Logger.warn(...)` seeds receiverType=Logger', async () => {
        const calls = await extractWithReceiver('kotlin', 'fun r() { Logger.warn("hi") }', 'src/r.kt');
        const warn = calls.find((c) => c.callName === 'warn');
        expect(warn?.receiverType).toBe('Logger');
    });

    it('C#: static call `Console.WriteLine(...)` seeds receiverType=Console', async () => {
        const calls = await extractWithReceiver(
            'csharp',
            'class A { void R() { Console.WriteLine("hi"); } }',
            'src/A.cs',
        );
        const wl = calls.find((c) => c.callName === 'WriteLine');
        expect(wl?.receiverType).toBe('Console');
    });

    it('Python: classmethod-style call `Logger.warn(...)` seeds receiverType=Logger', async () => {
        const calls = await extractWithReceiver('python', 'def r():\n    Logger.warn("hi")\n', 'src/r.py');
        const warn = calls.find((c) => c.callName === 'warn');
        expect(warn?.receiverType).toBe('Logger');
    });

    it('Python: lowercase receiver does NOT trigger static heuristic', async () => {
        const calls = await extractWithReceiver('python', 'def r():\n    config.load()\n', 'src/r.py');
        const load = calls.find((c) => c.callName === 'load');
        expect(load?.receiverType).toBeUndefined();
    });

    // ── Type cast / `as` assertion seeds receiverType ──

    it('TypeScript: `const x = something() as Foo` seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'TypeScript',
            'function r() { const x = something() as Foo; x.doWork(); }',
            'src/r.ts',
        );
        const doWork = calls.find((c) => c.callName === 'doWork');
        expect(doWork?.receiverType).toBe('Foo');
    });

    it('TypeScript: `const x = something() as Promise<Foo>` extracts outer generic name', async () => {
        const calls = await extractWithReceiver(
            'TypeScript',
            'function r() { const x = something() as Promise<Foo>; x.doWork(); }',
            'src/r.ts',
        );
        const doWork = calls.find((c) => c.callName === 'doWork');
        // generic_type wrapper — we extract the head identifier (Promise).
        expect(doWork?.receiverType).toBe('Promise');
    });

    it('Kotlin: `val x = something() as Foo` seeds receiverType', async () => {
        const calls = await extractWithReceiver(
            'kotlin',
            'fun r() { val x = something() as Foo\n    x.doWork() }',
            'src/r.kt',
        );
        const doWork = calls.find((c) => c.callName === 'doWork');
        expect(doWork?.receiverType).toBe('Foo');
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

    it('Python: self.repo.find_all() resolves at 0.95 when class attr has type hint', async () => {
        const src = `class UserRepository:
    def find_all(self):
        return []

class UserService:
    repo: UserRepository

    def handle(self):
        return self.repo.find_all()
`;
        const calls = await extractWithReceiver('python', src, 'sample.py');
        const findCall = calls.find((c) => c.callName === 'find_all');
        expect(findCall?.receiverType).toBe('UserRepository');

        const table = createSymbolTable();
        table.add('sample.py', 'find_all', 'sample.py::UserRepository.find_all');
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap());
        const resolved = callEdges.find((e) => e.callName === 'find_all');
        expect(resolved).toBeDefined();
        expect(resolved!.confidence).toBe(0.95);
        expect(resolved!.target).toBe('sample.py::UserRepository.find_all');
        expect(stats.receiver).toBe(1);
    });

    it('Python: self.cache.get() resolves at 0.95 when __init__ typed param stored on self', async () => {
        const src = `class Cache:
    def get(self, key):
        return None

class UserService:
    def __init__(self, cache: Cache):
        self.cache = cache

    def handle(self):
        return self.cache.get('k')
`;
        const calls = await extractWithReceiver('python', src, 'sample.py');
        const getCall = calls.find((c) => c.callName === 'get');
        expect(getCall?.receiverType).toBe('Cache');

        const table = createSymbolTable();
        table.add('sample.py', 'get', 'sample.py::Cache.get');
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap());
        const resolved = callEdges.find((e) => e.callName === 'get');
        expect(resolved).toBeDefined();
        expect(resolved!.confidence).toBe(0.95);
        expect(resolved!.target).toBe('sample.py::Cache.get');
        expect(stats.receiver).toBe(1);
    });

    it('Python: self.X: Type = ... inline annotation in __init__ body binds receiver type', async () => {
        const src = `class Other:
    def work(self):
        return 1

class UserService:
    def __init__(self):
        self.other: Other = make_other()

    def handle(self):
        return self.other.work()
`;
        const calls = await extractWithReceiver('python', src, 'sample.py');
        const workCall = calls.find((c) => c.callName === 'work');
        expect(workCall?.receiverType).toBe('Other');
    });
});

// ---------------------------------------------------------------------------
// Inheritance-aware receiver-tier lookup. When `Foo.method` isn't in the
// symbol table but Foo extends Bar / implements Baz where the method DOES
// exist, the resolver walks up the hierarchy and resolves at 0.85 confidence.
// ---------------------------------------------------------------------------

describe('receiver-type inheritance fallback', () => {
    it('extends: subclass call resolves to parent.method at 0.85', async () => {
        const calls: RawCallSite[] = [
            {
                source: 'src/UserService.java',
                callName: 'find',
                line: 1,
                column: 1,
                receiverType: 'UserService',
            },
        ];
        const table = createSymbolTable();
        // No `UserService.find` in the table — only the parent's.
        table.add('src/BaseService.java', 'find', 'src/BaseService.java::BaseService.find');
        const hierarchy = new Map<string, string[]>([['UserService', ['BaseService']]]);
        const { callEdges, stats } = resolveAllCalls(calls, new Map(), table, createImportMap(), undefined, hierarchy);
        expect(callEdges).toHaveLength(1);
        expect(callEdges[0].confidence).toBe(0.85);
        expect(callEdges[0].target).toBe('src/BaseService.java::BaseService.find');
        expect(stats.receiver).toBe(1);
    });

    it('multi-level: walks GrandChild → Child → Parent until hit', async () => {
        const calls: RawCallSite[] = [
            { source: 'src/A.java', callName: 'doIt', line: 1, column: 1, receiverType: 'GrandChild' },
        ];
        const table = createSymbolTable();
        table.add('src/Parent.java', 'doIt', 'src/Parent.java::Parent.doIt');
        const hierarchy = new Map<string, string[]>([
            ['GrandChild', ['Child']],
            ['Child', ['Parent']],
        ]);
        const { callEdges } = resolveAllCalls(calls, new Map(), table, createImportMap(), undefined, hierarchy);
        expect(callEdges).toHaveLength(1);
        expect(callEdges[0].target).toBe('src/Parent.java::Parent.doIt');
    });

    it('implements: interface method resolves via implements list', async () => {
        const calls: RawCallSite[] = [
            { source: 'src/Foo.java', callName: 'serialize', line: 1, column: 1, receiverType: 'Foo' },
        ];
        const table = createSymbolTable();
        table.add('src/Serializable.java', 'serialize', 'src/Serializable.java::Serializable.serialize');
        const hierarchy = new Map<string, string[]>([['Foo', ['Serializable']]]);
        const { callEdges } = resolveAllCalls(calls, new Map(), table, createImportMap(), undefined, hierarchy);
        expect(callEdges).toHaveLength(1);
        expect(callEdges[0].confidence).toBe(0.85);
        expect(callEdges[0].target).toBe('src/Serializable.java::Serializable.serialize');
    });

    it('cycle in hierarchy does not infinite-loop', async () => {
        const calls: RawCallSite[] = [
            { source: 'src/A.java', callName: 'unknown', line: 1, column: 1, receiverType: 'A' },
        ];
        const table = createSymbolTable();
        // No matching method anywhere.
        const hierarchy = new Map<string, string[]>([
            ['A', ['B']],
            ['B', ['A']],
        ]);
        const { callEdges } = resolveAllCalls(calls, new Map(), table, createImportMap(), undefined, hierarchy);
        // No resolution — falls through to cascade which also misses.
        expect(callEdges).toHaveLength(0);
    });

    it('direct hit on Foo.method takes precedence over inheritance', async () => {
        const calls: RawCallSite[] = [
            { source: 'src/A.java', callName: 'do', line: 1, column: 1, receiverType: 'Foo' },
        ];
        const table = createSymbolTable();
        table.add('src/Foo.java', 'do', 'src/Foo.java::Foo.do');
        table.add('src/Base.java', 'do', 'src/Base.java::Base.do');
        const hierarchy = new Map<string, string[]>([['Foo', ['Base']]]);
        const { callEdges } = resolveAllCalls(calls, new Map(), table, createImportMap(), undefined, hierarchy);
        expect(callEdges).toHaveLength(1);
        expect(callEdges[0].confidence).toBe(0.95);
        expect(callEdges[0].target).toBe('src/Foo.java::Foo.do');
    });
});
