# Phase 3: New Languages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Swift, Dart, Scala, C/C++, and Elixir support — 5 new languages, taking the total from 9 to 14.

**Architecture:** Each new language follows the same pattern established in Phase 1: install lang pack, create extractor implementing LanguageExtractors, create resolver, add external detection, register in engine. With the composable functions architecture, each language is a single focused file.

**Tech Stack:** ast-grep NAPI lang packs, bun:test, existing extractor/resolver/engine infrastructure.

---

## Task 1: Swift

**Files:**
- Create: `src/parser/extractors/swift.ts`
- Create: `src/resolver/languages/swift.ts`
- Modify: `src/parser/languages.ts` — register `.swift` extension
- Modify: `src/parser/extractor.ts` — import swift extractor
- Modify: `src/resolver/import-resolver.ts` — register swift resolver
- Modify: `src/resolver/external-detector.ts` — add swift detection
- Create: `tests/fixtures/swift/Sample.swift`
- Create: `tests/resolver/swift.test.ts`

Steps:
- [ ] Install: `bun add @ast-grep/lang-swift`
- [ ] Register language in languages.ts (`.swift` extension)
- [ ] Explore Swift AST by parsing sample code — discover node kinds for class, protocol, func, import, enum
- [ ] Create swift extractor implementing LanguageExtractors with all 4 new fields:
  - `is_exported`: `public`/`open` modifier
  - `is_async`: `async` keyword
  - `decorators`: `attribute` nodes (`@objc`, `@available`, `@discardableResult`)
  - `throws`: `throws` keyword in function signature
  - Heritage: `class X: Base, Protocol {}` via inheritance clause
  - Protocols as interfaces
- [ ] Create swift resolver: `import Module` → resolve via Package.swift or local module dirs
- [ ] Add swift external detection (Foundation, UIKit, SwiftUI = framework)
- [ ] Add fixture + tests (extraction + resolver)
- [ ] Run: `bun test` — all pass
- [ ] Commit: `feat: add Swift language support`

---

## Task 2: Dart

**Files:**
- Create: `src/parser/extractors/dart.ts`
- Create: `src/resolver/languages/dart.ts`
- Modify: `src/parser/languages.ts` — register `.dart`
- Modify: `src/parser/extractor.ts` — import dart extractor
- Modify: `src/resolver/import-resolver.ts` — register dart resolver
- Modify: `src/resolver/external-detector.ts` — add dart detection
- Create: `tests/fixtures/dart/Sample.dart`
- Create: `tests/resolver/dart.test.ts`

Steps:
- [ ] Install: `bun add @ast-grep/lang-dart`
- [ ] Register language
- [ ] Explore Dart AST
- [ ] Create dart extractor:
  - `is_exported`: name does NOT start with `_`
  - `is_async`: `async` keyword, or `Future` return type
  - `decorators`: `annotation` nodes (`@override`, `@protected`)
  - `throws`: [] (Dart has no throws clause)
  - Heritage: `class X extends Base with Mixin implements Interface {}`
  - Abstract classes, mixins
- [ ] Create dart resolver: `import 'package:name/path.dart'` → resolve via pubspec.yaml
- [ ] Add dart external detection (dart:core, flutter = framework, pub deps)
- [ ] Add fixture + tests
- [ ] Run: `bun test` — all pass
- [ ] Commit: `feat: add Dart language support`

---

## Task 3: Scala

**Files:**
- Create: `src/parser/extractors/scala.ts`
- Modify: `src/parser/languages.ts` — register `.scala`, `.sc`
- Modify: `src/parser/extractor.ts` — import scala extractor
- Modify: `src/resolver/import-resolver.ts` — register scala resolver (reuse Java)
- Modify: `src/resolver/external-detector.ts` — add scala detection
- Create: `tests/fixtures/scala/Sample.scala`

Steps:
- [ ] Install: `bun add @ast-grep/lang-scala`
- [ ] Register language
- [ ] Explore Scala AST
- [ ] Create scala extractor:
  - `is_exported`: everything public by default, `private`/`protected` = not exported
  - `is_async`: false (Scala uses Futures, no keyword)
  - `decorators`: `annotation` nodes
  - `throws`: `@throws` annotation
  - Heritage: `class X extends Base with Trait1 with Trait2`
  - `trait` as interface, `object` as singleton class, `case class`
- [ ] Register Java resolver for Scala (same JVM path resolution)
- [ ] Add scala external detection (scala.*, akka.*, play.* = framework)
- [ ] Add fixture + tests
- [ ] Run: `bun test` — all pass
- [ ] Commit: `feat: add Scala language support`

---

## Task 4: C/C++

**Files:**
- Create: `src/parser/extractors/c.ts` (handles both C and C++)
- Create: `src/resolver/languages/c.ts`
- Modify: `src/parser/languages.ts` — register `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`, `.cxx`
- Modify: `src/parser/extractor.ts` — import c extractor
- Modify: `src/resolver/import-resolver.ts` — register c resolver
- Modify: `src/resolver/external-detector.ts` — add c detection
- Create: `tests/fixtures/c/sample.c`
- Create: `tests/fixtures/cpp/sample.cpp`
- Create: `tests/resolver/c.test.ts`

Steps:
- [ ] Install: `bun add @ast-grep/lang-c @ast-grep/lang-cpp`
- [ ] Register both languages
- [ ] Explore C and C++ ASTs
- [ ] Create c extractor:
  - `is_exported`: `extern` keyword, or defined in header file (`.h`/`.hpp`)
  - `is_async`: false
  - `decorators`: [] (C/C++ has no decorators)
  - `throws`: [] (C++ exceptions are implicit, no declaration)
  - C: function_definition, struct, enum
  - C++: class_specifier, function_definition, namespace, template
  - Heritage: C++ `class X : public Base, public Interface {}`
- [ ] Create c resolver: `#include "file.h"` → resolve relative path, `#include <lib>` → null (system)
- [ ] Add c/cpp external detection (system includes = external)
- [ ] Add fixtures + tests
- [ ] Run: `bun test` — all pass
- [ ] Commit: `feat: add C/C++ language support`

---

## Task 5: Elixir

**Files:**
- Create: `src/parser/extractors/elixir.ts`
- Create: `src/resolver/languages/elixir.ts`
- Modify: `src/parser/languages.ts` — register `.ex`, `.exs`
- Modify: `src/parser/extractor.ts` — import elixir extractor
- Modify: `src/resolver/import-resolver.ts` — register elixir resolver
- Modify: `src/resolver/external-detector.ts` — add elixir detection
- Create: `tests/fixtures/elixir/sample.ex`
- Create: `tests/resolver/elixir.test.ts`

Steps:
- [ ] Install: `bun add @ast-grep/lang-elixir`
- [ ] Register language
- [ ] Explore Elixir AST
- [ ] Create elixir extractor:
  - `is_exported`: `def` = public, `defp` = private
  - `is_async`: false (Elixir concurrency via processes, no async keyword)
  - `decorators`: [] (Elixir has module attributes `@doc`, `@spec` but not decorators)
  - `throws`: [] (Elixir uses `raise`/`throw` but no declaration)
  - `defmodule` as class
  - Protocols as interfaces (behaviours)
  - No inheritance (composition via `use`/`import`/`alias`)
- [ ] Create elixir resolver: `alias MyApp.Module`, `import Module`, `use Module` → resolve via project structure + mix.exs
- [ ] Add elixir external detection (mix.exs deps, :erlang stdlib)
- [ ] Add fixture + tests
- [ ] Run: `bun test` — all pass
- [ ] Commit: `feat: add Elixir language support`

---

## Task 6: Final validation

- [ ] Run full test suite: `bun test`
- [ ] Parse Cal.com to verify no regression on existing languages
- [ ] Verify each new language compiles and extracts correctly
- [ ] Bump version
- [ ] Commit

---

## Summary

| Task | Language | Lang pack | Resolver |
|------|---------|-----------|----------|
| 1 | Swift | @ast-grep/lang-swift | New (Package.swift) |
| 2 | Dart | @ast-grep/lang-dart | New (pubspec.yaml) |
| 3 | Scala | @ast-grep/lang-scala | Reuse Java |
| 4 | C/C++ | @ast-grep/lang-c + cpp | New (#include) |
| 5 | Elixir | @ast-grep/lang-elixir | New (mix.exs) |
| 6 | Validate | — | — |

After Task 6: **14 languages** supported, all with dedicated extractors, resolvers, and the 4 new graph fields.
