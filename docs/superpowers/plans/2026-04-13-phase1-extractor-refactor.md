# Phase 1: Extractor Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 729-line generic.ts monolith with composable per-language extractors, each ~100-150 lines, behind a clean LanguageExtractors interface.

**Architecture:** Each language exports an object implementing `LanguageExtractors` (extractClasses, extractFunctions, extractImports, etc.). A central engine dispatches to the right extractor and converts `Extracted*` types to `Raw*` types. Shared helpers (modifiers, ancestor lookup, content hash) live in a common module imported by all.

**Tech Stack:** ast-grep NAPI, bun:test, TypeScript strict mode.

**Constraint:** All 528 existing tests must pass after each task. This is a refactor — behavior must NOT change.

---

## File Structure

### Create

- `src/parser/extractors/spec.ts` — `LanguageExtractors` interface + `Extracted*` types
- `src/parser/extractors/shared.ts` — reusable helper functions
- `src/parser/extractors/engine.ts` — dispatch + `Extracted*` → `Raw*` conversion
- `src/parser/extractors/go.ts` — Go extractor
- `src/parser/extractors/java.ts` — Java extractor
- `src/parser/extractors/kotlin.ts` — Kotlin extractor
- `src/parser/extractors/rust.ts` — Rust extractor
- `src/parser/extractors/csharp.ts` — C# extractor
- `src/parser/extractors/php.ts` — PHP extractor

### Modify

- `src/parser/extractors/typescript.ts` — rewrite to implement LanguageExtractors
- `src/parser/extractors/python.ts` — rewrite to implement LanguageExtractors
- `src/parser/extractors/ruby.ts` — rewrite to implement LanguageExtractors
- `src/parser/extractor.ts` — simplify to delegate to engine.ts
- `src/graph/types.ts` — no changes (Raw* types stay as-is for backward compat)

### Delete

- `src/parser/extractors/generic.ts` — replaced by per-language files

### Tests

- `tests/parser/extractor-engine.test.ts` — engine dispatch + conversion tests
- Existing tests in `tests/parser/` stay unchanged — they validate behavior

---

## Task 1: Create spec.ts — the interface contract

**Files:**
- Create: `src/parser/extractors/spec.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/parser/extractors/spec.ts
import type { SgNode } from '@ast-grep/napi';

export interface ExtractedClass {
    name: string;
    line_start: number;
    line_end: number;
    extends: string;
    implements: string[];
    modifiers: string;
    ast_kind: string;
    content_hash: string;
}

export interface ExtractedFunction {
    name: string;
    line_start: number;
    line_end: number;
    params: string;
    returnType: string;
    kind: 'Function' | 'Method' | 'Constructor';
    className: string;
    modifiers: string;
    ast_kind: string;
    content_hash: string;
    isTest: boolean;
}

export interface ExtractedImport {
    module: string;
    line: number;
    names: string[];
    lang: string;
}

export interface ExtractedReExport {
    module: string;
    line: number;
}

export interface ExtractedInterface {
    name: string;
    line_start: number;
    line_end: number;
    methods: string[];
    ast_kind: string;
    content_hash: string;
}

export interface ExtractedEnum {
    name: string;
    line_start: number;
    line_end: number;
    ast_kind: string;
    content_hash: string;
}

export interface ExtractedDI {
    fieldName: string;
    typeName: string;
}

export interface ExtractionResult {
    classes: ExtractedClass[];
    functions: ExtractedFunction[];
    imports: ExtractedImport[];
    reExports: ExtractedReExport[];
    interfaces: ExtractedInterface[];
    enums: ExtractedEnum[];
    diEntries: ExtractedDI[];
}

export interface LanguageExtractors {
    extract(root: SgNode, fp: string): ExtractionResult;
    extractCalls(root: SgNode, fp: string, calls: import('../../graph/types').RawCallSite[]): void;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bunx tsc --noEmit src/parser/extractors/spec.ts`

- [ ] **Step 3: Commit**

```bash
git add src/parser/extractors/spec.ts
git commit -m "feat: add LanguageExtractors interface and Extracted* types (spec.ts)"
```

---

## Task 2: Create shared.ts — reusable helpers

**Files:**
- Create: `src/parser/extractors/shared.ts`

- [ ] **Step 1: Extract shared helpers**

These helpers are currently duplicated across generic.ts, typescript.ts, python.ts, ruby.ts. Consolidate into one place:

```typescript
// src/parser/extractors/shared.ts
import type { SgNode } from '@ast-grep/napi';
import { createHash } from 'crypto';

/** Compute SHA-256 content hash for change detection. */
export function computeContentHash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Extract modifiers text from a node's 'modifiers' child (Java, C#, Kotlin, etc.) */
export function extractModifiers(node: SgNode): string {
    const mod = node.children().find((c) => c.kind() === 'modifiers');
    if (mod) return mod.text().replace(/\s+/g, ' ').trim();
    // Some languages use accessibility_modifier (TS)
    const acc = node.children().find((c) => c.kind() === 'accessibility_modifier');
    if (acc) return acc.text().trim();
    return '';
}

/** Find the nearest ancestor matching any of the given kinds. */
export function findAncestorByKinds(node: SgNode, kinds: string[]): SgNode | null {
    const kindSet = new Set(kinds);
    return node.ancestors().find((a) => kindSet.has(a.kind())) ?? null;
}

/** Get line range from a node. */
export function nodeRange(node: SgNode): { line_start: number; line_end: number } {
    return { line_start: node.range().start.line, line_end: node.range().end.line };
}

/** Check if a function name/node matches test patterns. */
export function isTestByNaming(fp: string, funcName: string, filePatterns: RegExp[], funcPatterns: RegExp[], matchMode: 'and' | 'or' = 'or'): boolean {
    const fileMatch = filePatterns.some((p) => p.test(fp));
    const funcMatch = funcPatterns.some((p) => p.test(funcName));
    if (matchMode === 'and') return fileMatch && funcMatch;
    return fileMatch || funcMatch;
}

/** Check if node has test annotation (Java @Test, C# [Test], etc.) */
export function hasTestAnnotation(node: SgNode, annotationKind: string, names: string[]): boolean {
    for (const sibling of node.prevAll()) {
        if (sibling.kind() === annotationKind && names.some((n) => sibling.text().includes(n))) {
            return true;
        }
    }
    for (const child of node.children()) {
        const ck = child.kind();
        if ((ck === 'modifiers' || ck === 'attribute_list' || ck === annotationKind) && names.some((n) => child.text().includes(n))) {
            return true;
        }
    }
    return false;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bunx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/parser/extractors/shared.ts
git commit -m "feat: add shared extractor helpers (shared.ts)"
```

---

## Task 3: Create engine.ts — dispatch + conversion

**Files:**
- Create: `src/parser/extractors/engine.ts`
- Create: `tests/parser/extractor-engine.test.ts`

- [ ] **Step 1: Create engine with dispatch logic**

```typescript
// src/parser/extractors/engine.ts
import type { SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import type { LanguageExtractors } from './spec';
import { log } from '../../shared/logger';

const EXTRACTORS: Record<string, LanguageExtractors> = {};

/** Register a language extractor. Called at module load time by each language file. */
export function registerExtractor(lang: string, extractor: LanguageExtractors): void {
    EXTRACTORS[lang] = extractor;
}

/** Check if a language has a registered extractor. */
export function hasExtractor(lang: string): boolean {
    return lang in EXTRACTORS;
}

/**
 * Extract all entities from a file using the appropriate language extractor.
 * Converts Extracted* types to Raw* types and pushes to graph.
 */
export function extractAll(
    root: SgRoot,
    fp: string,
    lang: string,
    seen: Set<string>,
    graph: RawGraph,
): void {
    const spec = EXTRACTORS[lang];
    if (!spec) {
        log.warn('No extractor registered for language', { lang, file: fp });
        return;
    }

    const rootNode = root.root();
    const result = spec.extract(rootNode, fp);

    // Convert classes
    for (const c of result.classes) {
        const key = `c:${fp}:${c.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        graph.classes.push({
            name: c.name,
            file: fp,
            line_start: c.line_start,
            line_end: c.line_end,
            extends: c.extends,
            implements: c.implements,
            ast_kind: c.ast_kind,
            qualified: `${fp}::${c.name}`,
            modifiers: c.modifiers || undefined,
            content_hash: c.content_hash,
        });
    }

    // Convert functions
    for (const f of result.functions) {
        const line = f.line_start;
        const key = `f:${fp}:${f.name}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const qualified = f.className
            ? `${fp}::${f.className}.${f.name}`
            : `${fp}::${f.name}`;

        // Test detection
        if (f.isTest) {
            const testKey = `t:${fp}:${f.name}:${line}`;
            if (!seen.has(testKey)) {
                seen.add(testKey);
                graph.tests.push({
                    name: f.name,
                    file: fp,
                    line_start: f.line_start,
                    line_end: f.line_end,
                    ast_kind: f.ast_kind,
                    qualified,
                    content_hash: f.content_hash,
                });
            }
        }

        graph.functions.push({
            name: f.name,
            file: fp,
            line_start: f.line_start,
            line_end: f.line_end,
            params: f.params,
            returnType: f.returnType,
            kind: f.kind,
            ast_kind: f.ast_kind,
            className: f.className,
            qualified,
            modifiers: f.modifiers || undefined,
            content_hash: f.content_hash,
        });
    }

    // Convert imports
    for (const i of result.imports) {
        graph.imports.push({
            module: i.module,
            file: fp,
            line: i.line,
            names: i.names,
            lang: i.lang,
        });
    }

    // Convert re-exports
    for (const re of result.reExports) {
        graph.reExports.push({
            module: re.module,
            file: fp,
            line: re.line,
        });
    }

    // Convert interfaces
    for (const iface of result.interfaces) {
        const key = `i:${fp}:${iface.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        graph.interfaces.push({
            name: iface.name,
            file: fp,
            line_start: iface.line_start,
            line_end: iface.line_end,
            methods: iface.methods,
            ast_kind: iface.ast_kind,
            qualified: `${fp}::${iface.name}`,
            content_hash: iface.content_hash,
        });
    }

    // Convert enums
    for (const e of result.enums) {
        const key = `e:${fp}:${e.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        graph.enums.push({
            name: e.name,
            file: fp,
            line_start: e.line_start,
            line_end: e.line_end,
            ast_kind: e.ast_kind,
            qualified: `${fp}::${e.name}`,
            content_hash: e.content_hash,
        });
    }

    // DI maps
    if (result.diEntries.length > 0) {
        const diMap = graph.diMaps.get(fp) ?? new Map<string, string>();
        for (const di of result.diEntries) {
            diMap.set(di.fieldName, di.typeName);
        }
        graph.diMaps.set(fp, diMap);
    }
}

/**
 * Extract call sites from a file.
 */
export function extractCallsFromEngine(
    root: SgRoot,
    fp: string,
    lang: string,
    calls: RawCallSite[],
): void {
    const spec = EXTRACTORS[lang];
    if (!spec) return;
    spec.extractCalls(root.root(), fp, calls);
}
```

- [ ] **Step 2: Create basic engine test**

```typescript
// tests/parser/extractor-engine.test.ts
import { describe, expect, it } from 'bun:test';
import { hasExtractor, registerExtractor } from '../../src/parser/extractors/engine';
import type { LanguageExtractors } from '../../src/parser/extractors/spec';

describe('extractor engine', () => {
    it('hasExtractor returns false for unregistered language', () => {
        expect(hasExtractor('nonexistent-lang-xyz')).toBe(false);
    });

    it('registerExtractor makes hasExtractor return true', () => {
        const mock: LanguageExtractors = {
            extract: () => ({
                classes: [], functions: [], imports: [],
                reExports: [], interfaces: [], enums: [], diEntries: [],
            }),
            extractCalls: () => {},
        };
        registerExtractor('test-lang-abc', mock);
        expect(hasExtractor('test-lang-abc')).toBe(true);
    });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/parser/extractor-engine.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/parser/extractors/engine.ts tests/parser/extractor-engine.test.ts
git commit -m "feat: add extractor engine with dispatch and Extracted→Raw conversion"
```

---

## Task 4: Migrate Go extractor

**Files:**
- Create: `src/parser/extractors/go.ts`

This is the first migration. Extract all Go-specific code from generic.ts into a standalone file implementing LanguageExtractors.

- [ ] **Step 1: Create Go extractor**

Read `src/parser/extractors/generic.ts` and extract all Go-specific logic:
- `goTypeKind()`, `goTypeName()` helpers
- Go struct class extraction (type_declaration → struct_type)
- Go interface extraction (type_declaration → interface_type)
- Go method extraction with receiver type parsing
- Go struct embedding (extends)
- Go import extraction (import_declaration)
- Go test detection (file _test.go AND func name Test*/Benchmark*)
- Go call extraction config

The Go extractor must produce IDENTICAL output to what generic.ts produces for Go files today.

- [ ] **Step 2: Register in engine and wire up in extractor.ts**

In `src/parser/extractor.ts`, add:
```typescript
import './extractors/go'; // triggers registration
```

In `src/parser/extractors/go.ts`, at the bottom:
```typescript
import { registerExtractor } from './engine';
registerExtractor('go', goExtractors);
```

Update `src/parser/extractor.ts` to route Go through the engine:
```typescript
import { extractAll, extractCallsFromEngine, hasExtractor } from './extractors/engine';

export function extractFromFile(...) {
    if (hasExtractor(lang as string)) {
        extractAll(root, filePath, lang as string, seen, graph);
        return;
    }
    // existing fallback for languages not yet migrated
    if (isTypeScriptLike(lang)) { ... }
}
```

- [ ] **Step 3: Run ALL tests**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test`
Expected: All 528+ tests pass — Go extraction output identical to before.

- [ ] **Step 4: Commit**

```bash
git add src/parser/extractors/go.ts src/parser/extractor.ts
git commit -m "refactor: extract Go into dedicated extractor (go.ts)"
```

---

## Task 5: Migrate Java extractor

**Files:**
- Create: `src/parser/extractors/java.ts`

Same approach as Task 4. Extract Java-specific code from generic.ts:
- Class extraction with heritage finders from LANG_CONFIGS
- Method extraction with annotation support
- Import extraction
- Test detection with @Test annotation
- Multi-module source root discovery (Maven pom.xml, Gradle settings.gradle)

- [ ] **Step 1: Create Java extractor, register, wire up**
- [ ] **Step 2: Run ALL tests — must pass**
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract Java into dedicated extractor (java.ts)"
```

---

## Task 6: Migrate Kotlin extractor

**Files:**
- Create: `src/parser/extractors/kotlin.ts`

Extract Kotlin-specific code from generic.ts:
- Kotlin disambiguation (class vs interface vs enum sharing class_declaration)
- Kotlin name extraction (no field('name'))
- Heritage via delegation_specifier
- Test detection with @Test annotation

- [ ] **Step 1: Create Kotlin extractor, register, wire up**
- [ ] **Step 2: Run ALL tests — must pass**
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract Kotlin into dedicated extractor (kotlin.ts)"
```

---

## Task 7: Migrate Rust extractor

**Files:**
- Create: `src/parser/extractors/rust.ts`

Extract Rust-specific code:
- struct_item as class (NOT impl_item)
- impl block → className for contained functions
- impl Trait for Struct → implements
- trait_item as interface
- use_declaration imports

- [ ] **Step 1: Create Rust extractor, register, wire up**
- [ ] **Step 2: Run ALL tests — must pass**
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: extract Rust into dedicated extractor (rust.ts)"
```

---

## Task 8: Migrate C#, PHP extractors

**Files:**
- Create: `src/parser/extractors/csharp.ts`
- Create: `src/parser/extractors/php.ts`

- [ ] **Step 1: Create C# extractor, register, wire up**
- [ ] **Step 2: Create PHP extractor, register, wire up**
- [ ] **Step 3: Run ALL tests — must pass**
- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: extract C# and PHP into dedicated extractors"
```

---

## Task 9: Migrate TypeScript, Python, Ruby extractors

These already have dedicated files but don't implement LanguageExtractors. Rewrite to conform:

**Files:**
- Modify: `src/parser/extractors/typescript.ts` — wrap in LanguageExtractors
- Modify: `src/parser/extractors/python.ts` — wrap in LanguageExtractors
- Modify: `src/parser/extractors/ruby.ts` — wrap in LanguageExtractors

The existing logic stays — just wrap it to return `ExtractionResult` instead of pushing directly to `graph`.

- [ ] **Step 1: Wrap TypeScript extractor**

The existing `extractTypeScript(root, fp, seen, graph, lang)` pushes directly to graph. Refactor to:
1. Create internal `extract(root, fp)` that returns `ExtractionResult`
2. Export a `LanguageExtractors` object
3. Register with engine

- [ ] **Step 2: Wrap Python extractor — same approach**
- [ ] **Step 3: Wrap Ruby extractor — same approach**
- [ ] **Step 4: Run ALL tests — must pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: wrap TS, Python, Ruby extractors in LanguageExtractors interface"
```

---

## Task 10: Delete generic.ts and simplify extractor.ts

**Files:**
- Delete: `src/parser/extractors/generic.ts`
- Modify: `src/parser/extractor.ts` — remove all if/else, delegate everything to engine

- [ ] **Step 1: Simplify extractor.ts**

```typescript
// src/parser/extractor.ts
import type { Lang, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../graph/types';
import { extractAll, extractCallsFromEngine } from './extractors/engine';
import { getLanguageName } from './languages';

// Import all language extractors to trigger registration
import './extractors/typescript';
import './extractors/python';
import './extractors/ruby';
import './extractors/go';
import './extractors/java';
import './extractors/kotlin';
import './extractors/rust';
import './extractors/csharp';
import './extractors/php';

export function extractFromFile(
    root: SgRoot,
    filePath: string,
    lang: Lang | string,
    seen: Set<string>,
    graph: RawGraph,
): void {
    const langName = getLanguageName(lang);
    extractAll(root, filePath, langName, seen, graph);
}

export function extractCallsFromFile(
    root: SgRoot,
    filePath: string,
    lang: Lang | string,
    calls: RawCallSite[],
): void {
    const langName = getLanguageName(lang);
    extractCallsFromEngine(root, filePath, langName, calls);
}
```

- [ ] **Step 2: Delete generic.ts**

```bash
rm src/parser/extractors/generic.ts
```

- [ ] **Step 3: Run ALL tests**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test`
Expected: All tests pass. generic.ts is gone.

- [ ] **Step 4: Run against a real repo to verify**

Run: `bun src/cli.ts parse --all --repo-dir /Users/wellingtonsantana/Documents/kodus-git/projects-trd/calcom-greptile-test --out /tmp/graph-refactor-test.json`
Expected: Same node/edge counts as before.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete generic.ts — all languages have dedicated extractors

9 language extractors, each implementing LanguageExtractors interface.
Engine handles dispatch and Raw* conversion. Shared helpers in shared.ts.
generic.ts (729 lines) replaced by 9 focused files (~100-150 lines each)."
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | spec.ts — interface | 1 new |
| 2 | shared.ts — helpers | 1 new |
| 3 | engine.ts — dispatch | 1 new + 1 test |
| 4 | Go extractor | 1 new + 1 modify |
| 5 | Java extractor | 1 new |
| 6 | Kotlin extractor | 1 new |
| 7 | Rust extractor | 1 new |
| 8 | C# + PHP extractors | 2 new |
| 9 | TS + Python + Ruby wrap | 3 modify |
| 10 | Delete generic.ts | 1 delete + 1 modify |

After Task 10: **generic.ts gone**, 9 language extractors, all tests green, ready for Phase 2 (new fields) and Phase 3 (new languages).
