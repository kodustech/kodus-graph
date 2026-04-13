# Phase 2: New Graph Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `is_exported`, `is_async`, `decorators`, and `throws` fields to the graph, extracted per-language via shared helpers, and integrated into contract diffs and blast radius.

**Architecture:** Add new optional fields to `ExtractedFunction`, `ExtractedClass`, `RawFunction`, `RawClass`, and `GraphNode`. Create shared helpers in `shared.ts` for common extraction patterns. Each language extractor calls the helpers with language-specific config. Builder propagates new fields. Diff detects changes in `is_async` and `decorators` as contract diffs.

**Tech Stack:** ast-grep NAPI, bun:test, existing extractor architecture from Phase 1.

---

## Task 1: Add new fields to types

**Files:**
- Modify: `src/parser/extractors/spec.ts`
- Modify: `src/graph/types.ts`
- Modify: `src/graph/builder.ts`

Add to `ExtractedFunction`:
```typescript
is_exported: boolean;
is_async: boolean;
decorators: string[];
throws: string[];
```

Add to `ExtractedClass`:
```typescript
is_exported: boolean;
decorators: string[];
```

Add to `RawFunction`:
```typescript
is_exported?: boolean;
is_async?: boolean;
decorators?: string[];
throws?: string[];
```

Add to `RawClass`:
```typescript
is_exported?: boolean;
decorators?: string[];
```

Add to `GraphNode`:
```typescript
is_exported?: boolean;
is_async?: boolean;
decorators?: string[];
throws?: string[];
```

Update `engine.ts` to propagate new fields in Extracted→Raw conversion.
Update `builder.ts` to propagate from Raw→GraphNode.

- [ ] Add fields to all type interfaces
- [ ] Update engine.ts conversion
- [ ] Update builder.ts propagation
- [ ] Run: `bun test` — all must pass (new fields are optional, backward compat)
- [ ] Commit

---

## Task 2: Add shared helpers for new fields

**Files:**
- Modify: `src/parser/extractors/shared.ts`

Add helpers:

```typescript
/** Check if a node is exported. Language-specific rules passed as config. */
export function isExported(node: SgNode, rules: ExportRules): boolean;

/** Check if a function node is async. */
export function isAsync(node: SgNode): boolean;

/** Extract decorator/annotation texts from a node. */
export function extractDecorators(node: SgNode, kinds: string[]): string[];

/** Extract throw/raise types from a function body. */
export function extractThrows(body: SgNode, throwKinds: string[]): string[];
```

Types:
```typescript
export interface ExportRules {
    // Check for keyword before declaration (export, pub, public, etc.)
    exportKeywords?: string[];
    // Check modifier node for these words
    modifierKeywords?: string[];
    // Custom check (Go: uppercase first letter, Python: no _ prefix)
    customCheck?: (name: string, node: SgNode) => boolean;
}
```

- [ ] Add ExportRules type and all 4 helpers
- [ ] Add unit tests in tests/parser/shared-helpers.test.ts
- [ ] Run: `bun test` — all pass
- [ ] Commit

---

## Task 3: Implement in TypeScript extractor

**Files:**
- Modify: `src/parser/extractors/typescript.ts`

TS/JS rules:
- `is_exported`: node is inside `export_statement`, or has `export` keyword as sibling
- `is_async`: has `async` keyword child
- `decorators`: find `decorator` siblings/children (e.g., `@Injectable()`)
- `throws`: find `throw_statement` nodes inside function body

- [ ] Add extraction using shared helpers
- [ ] Add tests
- [ ] Run: `bun test` — all pass
- [ ] Commit

---

## Task 4: Implement in Python extractor

**Files:**
- Modify: `src/parser/extractors/python.ts`

Python rules:
- `is_exported`: name doesn't start with `_`
- `is_async`: `async def` (function kind is `async_function_definition` or has `async` keyword)
- `decorators`: find `decorated_definition` parent, extract decorator nodes
- `throws`: find `raise_statement` nodes in body

- [ ] Add extraction
- [ ] Add tests
- [ ] Run: `bun test` — all pass
- [ ] Commit

---

## Task 5: Implement in Go, Java, Kotlin extractors

**Files:**
- Modify: `src/parser/extractors/go.ts`
- Modify: `src/parser/extractors/java.ts`
- Modify: `src/parser/extractors/kotlin.ts`

Go rules:
- `is_exported`: name starts with uppercase
- `is_async`: false (Go uses goroutines, not async keyword)
- `decorators`: [] (Go has no decorators)
- `throws`: [] (Go returns errors, doesn't throw)

Java rules:
- `is_exported`: `public` in modifiers
- `is_async`: false
- `decorators`: `marker_annotation` + `annotation` nodes (already extracted in modifiers, now also in decorators array)
- `throws`: `throws` clause text

Kotlin rules:
- `is_exported`: `public` or no visibility modifier (default is public)
- `is_async`: `suspend` keyword
- `decorators`: annotation nodes
- `throws`: `@Throws` annotation

- [ ] Implement all 3
- [ ] Add tests for each
- [ ] Run: `bun test` — all pass
- [ ] Commit

---

## Task 6: Implement in Rust, C#, PHP, Ruby extractors

**Files:**
- Modify: `src/parser/extractors/rust.ts`
- Modify: `src/parser/extractors/csharp.ts`
- Modify: `src/parser/extractors/php.ts`
- Modify: `src/parser/extractors/ruby.ts`

Rust: `is_exported` = `pub`, `is_async` = `async fn`, `decorators` = `#[derive()]` etc., `throws` = []
C#: `is_exported` = `public`, `is_async` = `async`, `decorators` = `[Attribute]`, `throws` = `throw` in body
PHP: `is_exported` = not `private`/`protected`, `is_async` = false, `decorators` = [], `throws` = `throw_expression`
Ruby: `is_exported` = not after `private`/`protected`, `is_async` = false, `decorators` = [], `throws` = `raise` calls

- [ ] Implement all 4
- [ ] Add tests for each
- [ ] Run: `bun test` — all pass
- [ ] Commit

---

## Task 7: Integrate into contract diffs

**Files:**
- Modify: `src/analysis/diff.ts`
- Modify: `src/analysis/enrich.ts`
- Modify: `src/analysis/prompt-formatter.ts`

Add detection:
- `is_async` change (false→true or true→false) = contract diff
- `decorators` change (added/removed decorator) = contract diff

Update `ContractDiff` field type:
```typescript
field: 'params' | 'return_type' | 'modifiers' | 'is_async' | 'decorators';
```

Update caller_impact for async changes:
```
Impact: 3 callers must add await (sync→async change)
```

Update prompt-formatter:
```
- is_async: false -> true
- decorators: [@Injectable()] -> [@Injectable(), @Singleton()]
```

- [ ] Add is_async and decorators to diff detection
- [ ] Update caller_impact messages
- [ ] Update prompt format
- [ ] Add tests
- [ ] Run: `bun test` — all pass
- [ ] Commit

---

## Task 8: Integrate is_exported into blast radius

**Files:**
- Modify: `src/analysis/blast-radius.ts`

When building adjacency for BFS:
- If a function is NOT exported and the caller is in a DIFFERENT file → skip the edge (the call resolution was probably wrong)
- This reduces false blast radius from ambiguous calls to private functions

- [ ] Add is_exported check in BFS edge filtering
- [ ] Add test: private function change doesn't propagate to other files
- [ ] Add test: exported function change propagates normally
- [ ] Run: `bun test` — all pass
- [ ] Commit

---

## Task 9: Validate against real repos

- [ ] Re-parse Cal.com — verify new fields are populated
- [ ] Check: exported functions have `is_exported: true`
- [ ] Check: async functions have `is_async: true`
- [ ] Check: decorated classes have `decorators` array
- [ ] Commit any fixes

---

## Summary

| Task | What |
|------|------|
| 1 | Add fields to types (spec, Raw, GraphNode, engine, builder) |
| 2 | Shared helpers (isExported, isAsync, extractDecorators, extractThrows) |
| 3 | TypeScript extractor |
| 4 | Python extractor |
| 5 | Go + Java + Kotlin extractors |
| 6 | Rust + C# + PHP + Ruby extractors |
| 7 | Contract diffs + prompt format |
| 8 | Blast radius is_exported filter |
| 9 | Validate against real repos |
