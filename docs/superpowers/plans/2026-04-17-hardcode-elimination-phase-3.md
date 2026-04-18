# Hardcode Elimination — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make language differences first-class citizens of the graph — declare per-language capabilities so analysis code stops silently assuming TS/Java semantics, add light receiver-type tracking so `x.update()` resolves to `Foo.update` when `x: Foo` is visible in scope, and expose resolver tier distribution in `ParseMetadata` so consumers can see the "honesty gap" on dynamic-language repos.

**Architecture:** One new registry (`LanguageCapabilities`, populated per-language via side-effect), one new extractor responsibility (emit a lightweight receiver-type map per file), one new output field (`tier_distribution` in `ParseMetadata`). All three are additive — no existing caller changes behavior unless it opts in by reading the new fields.

**Tech Stack:** TypeScript (strict), Bun runtime, `bun:test`, Zod schemas, ast-grep.

**Prerequisites:**
- Phase 1 merged (per-language noise registry, `languageOfFile`, statistical ambiguous-noise, cyclomatic complexity, configurable risk score).
- Phase 2 merged (`alternatives` on ambiguous edges, per-language DI heuristics, `GraphIndex`).
- Branch: `feat/phase-3-language-capabilities` off main.

**Out of scope:**
- Full type inference (Hindley-Milner, flow analysis). This plan's receiver inference is intentionally shallow: it tracks `const x = new Foo()` and `const x: Foo = ...` within a single function scope. That covers ~80% of the cases the resolver drops to 0.30 today; deep type inference is a separate multi-month project.
- Replacing the confidence cascade. Receiver-type information feeds the cascade as a new high-confidence tier; it doesn't replace same-file / import / unique / ambiguous.

---

## File Structure

### New files

- `src/languages/capabilities.ts` — `LanguageCapabilities` type + registry (`registerCapabilities`, `getCapabilitiesFor`). Each language declares what it supports.
- `src/languages/receiver-types.ts` — `ReceiverTypeMap` shape + helpers. Extractors populate per file; the resolver consults.
- `tests/languages/capabilities.test.ts`
- `tests/languages/receiver-types.test.ts`
- `tests/resolver/receiver-aware.test.ts`

### Modified files

- `src/languages/spec.ts` — add optional `extractReceiverTypes(root, fp): ReceiverTypeMap` to `LanguageExtractors`.
- `src/languages/engine.ts` — dispatcher `getCapabilitiesFor(lang)`, `extractReceiverTypesFor(lang, root, fp)`.
- `src/languages/<lang>/extractor.ts` — each calls `registerCapabilities(<key>, { ... })` at module load; each that can reasonably track receiver types implements `extractReceiverTypes`. Priority order: TypeScript, Java, C#, Kotlin (statically typed, easy). Python/TS can also do `x = Foo()` sniffing. Go uses `:=` with type inference — implement via `const x = NewFoo()` factory-function pattern. Rust: `let x = Foo::new()` — same factory pattern. Opt-out languages (Ruby, PHP without type hints, Elixir, dynamic cases): implement as no-op returning empty map.
- `src/graph/types.ts` — add `receiverType?: string` to `RawCallSite` (set during call-extraction when receiver type is known); add `TierDistribution` and `tier_distribution?: TierDistribution` to `ParseMetadata`.
- `src/shared/schemas.ts` — mirror `tier_distribution` in `parseMetadataSchema`.
- `src/resolver/call-resolver.ts` — before the DI + name-based cascade, consult receiver types: if `call.receiverType` is set and has a unique match, resolve to that with confidence 0.95 (above same-file's 0.85). Record per-tier counts in `stats` and surface them.
- `src/commands/parse.ts` — populate `metadata.tier_distribution` from the aggregated resolver stats.
- `src/analysis/enrich.ts` — where analysis code currently assumes all languages have `is_async` or `throws`, consult `getCapabilitiesFor(node.language)` and skip or default appropriately. Concrete touch points surface during implementation.
- `src/analysis/prompt-formatter.ts` — skip `async` changes in contract diffs for languages where `capabilities.hasAsync === false`.
- `src/index.ts` — re-export `LanguageCapabilities`, `getCapabilitiesFor`.

---

## Task 1: `LanguageCapabilities` registry

**Rationale.** Today `prompt-formatter.ts` renders `is_async: false → true` as a contract change regardless of language. In Go, `is_async` is always false (no async/await keyword — concurrency is goroutines). In Rust, async is keyword-level but the surface is different. `extractThrows` tries to pull from every language but Rust uses `Result<_, E>` instead. Silent assumptions like these produce wrong prompts.

Make each language declare what it supports, so analysis code can branch on capability instead of running the same code everywhere and hoping.

**Files:**
- Create: `src/languages/capabilities.ts`, `tests/languages/capabilities.test.ts`.
- Modify: each `src/languages/<lang>/extractor.ts` to register its capabilities.
- Modify: `src/analysis/prompt-formatter.ts` (skip `is_async` rendering when language says `hasAsync: false`).
- Modify: `src/index.ts`.

- [ ] **Step 1.1: Write the failing test**

`tests/languages/capabilities.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { getCapabilitiesFor } from '../../src/languages/capabilities';
import '../../src/languages/typescript';
import '../../src/languages/go';
import '../../src/languages/rust';
import '../../src/languages/python';

describe('LanguageCapabilities', () => {
    it('TypeScript: async + decorators + exceptions + structural interfaces', () => {
        const c = getCapabilitiesFor('TypeScript')!;
        expect(c.hasAsync).toBe(true);
        expect(c.hasDecorators).toBe(true);
        expect(c.hasExceptions).toBe(true);
        expect(c.hasStaticTypes).toBe(true);
        expect(c.interfaceKind).toBe('structural');
    });

    it('Go: no async, no decorators, structural interfaces, has static types', () => {
        const c = getCapabilitiesFor('go')!;
        expect(c.hasAsync).toBe(false);
        expect(c.hasDecorators).toBe(false);
        expect(c.interfaceKind).toBe('structural');
        expect(c.hasStaticTypes).toBe(true);
    });

    it('Rust: has async + attributes + Result-based error handling (not try/catch exceptions)', () => {
        const c = getCapabilitiesFor('rust')!;
        expect(c.hasAsync).toBe(true);
        expect(c.hasDecorators).toBe(true); // #[attribute] counts
        expect(c.hasExceptions).toBe(false); // Rust uses Result<T, E>
        expect(c.interfaceKind).toBe('nominal'); // trait-based, nominal
    });

    it('Python: has async + decorators + exceptions + duck typing', () => {
        const c = getCapabilitiesFor('python')!;
        expect(c.hasAsync).toBe(true);
        expect(c.hasDecorators).toBe(true);
        expect(c.hasExceptions).toBe(true);
        expect(c.hasStaticTypes).toBe(false); // type hints optional
        expect(c.interfaceKind).toBe('duck');
    });

    it('unknown language returns null', () => {
        expect(getCapabilitiesFor('Klingon')).toBeNull();
    });
});
```

- [ ] **Step 1.2: Create `src/languages/capabilities.ts`**

```typescript
/**
 * Per-language capability declarations. Each language registers what it
 * supports at module load. Analysis code consults the registry instead of
 * assuming TS/Java semantics everywhere.
 */

export interface LanguageCapabilities {
    /** Language has explicit async/await keyword semantics. */
    hasAsync: boolean;
    /** Decorators / annotations / attributes that attach metadata to declarations. */
    hasDecorators: boolean;
    /** try/catch-style exception handling (distinct from Result/Option or error returns). */
    hasExceptions: boolean;
    /** Types are checked statically (compile-time). False means dynamic / duck-typed / gradual. */
    hasStaticTypes: boolean;
    /** How interfaces (or equivalents) work. */
    interfaceKind: 'nominal' | 'structural' | 'duck';
}

const REGISTRY = new Map<string, LanguageCapabilities>();

export function registerCapabilities(language: string, caps: LanguageCapabilities): void {
    REGISTRY.set(language, caps);
}

export function getCapabilitiesFor(language: string): LanguageCapabilities | null {
    return REGISTRY.get(language) ?? null;
}
```

- [ ] **Step 1.3: Register per-language capabilities**

In each language's `extractor.ts` (call at module top-level alongside `registerExtractor`):

**TypeScript** (`src/languages/typescript/extractor.ts`):
```typescript
import { registerCapabilities } from '../capabilities';
const TS_CAPS = {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'structural' as const,
};
registerCapabilities('TypeScript', TS_CAPS);
registerCapabilities('Tsx', TS_CAPS);
registerCapabilities('JavaScript', { ...TS_CAPS, hasStaticTypes: false });
```

**Python**:
```typescript
registerCapabilities('python', {
    hasAsync: true, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: false, interfaceKind: 'duck',
});
```

**Ruby**:
```typescript
registerCapabilities('ruby', {
    hasAsync: false, hasDecorators: false, hasExceptions: true,
    hasStaticTypes: false, interfaceKind: 'duck',
});
```

**Go**:
```typescript
registerCapabilities('go', {
    hasAsync: false, hasDecorators: false, hasExceptions: false,
    hasStaticTypes: true, interfaceKind: 'structural',
});
```

**Java**:
```typescript
registerCapabilities('java', {
    hasAsync: true, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: true, interfaceKind: 'nominal',
});
```

**Kotlin**:
```typescript
registerCapabilities('kotlin', {
    hasAsync: true, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: true, interfaceKind: 'nominal',
});
```

**Rust**:
```typescript
registerCapabilities('rust', {
    hasAsync: true, hasDecorators: true, hasExceptions: false,
    hasStaticTypes: true, interfaceKind: 'nominal',
});
```

**C#**:
```typescript
registerCapabilities('csharp', {
    hasAsync: true, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: true, interfaceKind: 'nominal',
});
```

**PHP**:
```typescript
registerCapabilities('php', {
    hasAsync: false, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: false, interfaceKind: 'nominal',
});
```

**Swift**:
```typescript
registerCapabilities('swift', {
    hasAsync: true, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: true, interfaceKind: 'nominal',
});
```

**Dart**:
```typescript
registerCapabilities('dart', {
    hasAsync: true, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: true, interfaceKind: 'nominal',
});
```

**Scala**:
```typescript
registerCapabilities('scala', {
    hasAsync: true, hasDecorators: true, hasExceptions: true,
    hasStaticTypes: true, interfaceKind: 'structural',
});
```

**C / C++** (register once per key in `c/extractor.ts`):
```typescript
const C_CAPS = {
    hasAsync: false, hasDecorators: false, hasExceptions: false,
    hasStaticTypes: true, interfaceKind: 'nominal' as const,
};
registerCapabilities('c', C_CAPS);
registerCapabilities('cpp', { ...C_CAPS, hasExceptions: true }); // C++ has try/catch
```

**Elixir**:
```typescript
registerCapabilities('elixir', {
    hasAsync: false, hasDecorators: true, hasExceptions: false, // try/rescue exists but idiomatic Elixir uses tagged tuples
    hasStaticTypes: false, interfaceKind: 'duck', // behaviours exist but typically duck
});
```

Values are debatable at the margins (e.g. Elixir's `hasExceptions`, Rust's "decorators" counting attributes). Comment inline where you make a judgment call. Reasonable teams can disagree — the important thing is the value is _explicit_ and overridable.

- [ ] **Step 1.4: Run the capabilities test — green**

`bun test tests/languages/capabilities.test.ts`

- [ ] **Step 1.5: Use capabilities in `prompt-formatter.ts`**

Find where contract diffs render `is_async` changes (search for `is_async:` in `src/analysis/prompt-formatter.ts`). Wrap:

```typescript
import { getCapabilitiesFor } from '../languages/capabilities';

// ... in the per-function rendering loop:
const caps = getCapabilitiesFor(fn.language);
if (caps?.hasAsync !== false && diff.is_async) {
    lines.push(`     is_async: ${diff.is_async.before} -> ${diff.is_async.after}`);
}
```

For `throws` changes, similarly skip if `!caps?.hasExceptions`.

Add tests that assert a Go function's contract diff does NOT include `is_async` even if the diff struct has `is_async: { before: false, after: false }`.

- [ ] **Step 1.6: Export from `src/index.ts`**

```typescript
export type { LanguageCapabilities } from './languages/capabilities';
export { getCapabilitiesFor } from './languages/capabilities';
```

- [ ] **Step 1.7: Full check**

`bun run check` → green. Some existing prompt-formatter snapshot tests may change (Go diffs no longer show `is_async`). Update the snapshots.

- [ ] **Step 1.8: Commit**

```bash
git add src/languages/capabilities.ts src/languages/*/extractor.ts src/analysis/prompt-formatter.ts src/index.ts tests/languages/capabilities.test.ts tests/analysis/
git commit -m "feat(capabilities): per-language capability registry, prompt-formatter honors hasAsync/hasExceptions"
```

---

## Task 2: Receiver-type-aware call resolution

**Rationale.** Today `x.update()` and `y.update()` both fall through to the ambiguous 0.30 tier when `update` is defined in many classes. If the extractor knows `x` is of type `Foo` (because `const x = new Foo()` is in the same function), we can resolve directly to `Foo.update` at high confidence. Implementing full type inference is a large project; a shallow scope-local tracker covers the common cases.

**Files:**
- Create: `src/languages/receiver-types.ts`, `tests/languages/receiver-types.test.ts`, `tests/resolver/receiver-aware.test.ts`.
- Modify: `src/languages/spec.ts` — add `extractReceiverTypes?(root, fp): ReceiverTypeMap`.
- Modify: `src/languages/engine.ts` — dispatcher.
- Modify: `src/languages/{typescript,java,kotlin,csharp,rust,go,python,swift,dart,scala,cpp}/extractor.ts` — implement for statically-typed or factory-sniffable languages. Ruby/PHP/Elixir can implement as no-op for now.
- Modify: `src/parser/extractor.ts` / `src/parser/batch.ts` — call `extractReceiverTypes` during extraction, attach resulting map to the file's raw data.
- Modify: `src/graph/types.ts` — add `receiverType?: string` to `RawCallSite`; add `receiverTypes?: Record<string, string>` somewhere in the per-file raw output (or pass alongside).
- Modify: `src/resolver/call-resolver.ts` — consult receiver types at a new high-confidence tier (0.95) before DI and name-based.

### Design: the `ReceiverTypeMap`

```typescript
/**
 * Maps a call-site location key to the inferred type of its receiver.
 *
 * Key: `${source_file}:${line}:${column}` for the method-call expression.
 * Value: unqualified type name (e.g. 'UserService').
 *
 * Extractors populate this during `extractReceiverTypes`. The resolver looks
 * up each RawCallSite by its location key to see if a receiver type is known.
 */
export type ReceiverTypeMap = Map<string, string>;
```

**Algorithm sketch (TypeScript — others follow the same pattern adapted to grammar):**

For each function in the file, walk its body collecting:
- `const x = new Foo()` / `let x = new Foo()` / `var x = new Foo()` → record `x: Foo`.
- `const x: Foo = ...` / `let x: Foo = ...` (explicit type annotation) → record `x: Foo`.
- `const x = someFactory()` where `someFactory` has a return type annotation → look up the factory's return type and record.

Then walk method-call expressions in the same function body:
- `x.method()` → look up `x` in the local var map; if found, record `{loc, type}` in the receiver-type map.
- `this.field.method()` is already handled by the DI path.

Keep scope flat at function-level: don't worry about blocks inside a function, closures, or reassignments. False negatives are fine; false positives are not.

- [ ] **Step 2.1: Write receiver-types helper test**

`tests/languages/receiver-types.test.ts` — unit tests for the helper algorithm in isolation (doesn't need language extractors yet; just tests that given a tiny AST-ish input, the map comes out right). Use TS as the sole driver.

- [ ] **Step 2.2: Write end-to-end resolver-aware test**

`tests/resolver/receiver-aware.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { SymbolTable } from '../../src/resolver/symbol-table';
import { ImportMap } from '../../src/resolver/import-map';
import '../../src/languages/typescript';

describe('receiver-type-aware resolution', () => {
    it('resolves x.update() to Foo.update when receiverType is Foo', () => {
        const table = new SymbolTable();
        // Two classes with `update` — without receiver type, this is ambiguous.
        table.register('src/foo.ts::Foo.update');
        table.register('src/bar.ts::Bar.update');
        const { callEdges, stats } = resolveAllCalls(
            [{
                source: 'src/caller.ts',
                callName: 'update',
                line: 10,
                receiverType: 'Foo',
            }],
            new Map(),
            table,
            new ImportMap(),
        );
        expect(stats.receiver).toBe(1);
        expect(callEdges[0].target).toBe('src/foo.ts::Foo.update');
        expect(callEdges[0].confidence).toBe(0.95);
    });

    it('falls back to name-based cascade when receiverType has no match', () => {
        const table = new SymbolTable();
        table.register('src/caller.ts::helper');
        const { callEdges } = resolveAllCalls(
            [{
                source: 'src/caller.ts',
                callName: 'helper',
                line: 1,
                receiverType: 'NonexistentType',
            }],
            new Map(),
            table,
            new ImportMap(),
        );
        expect(callEdges[0].confidence).toBe(0.85); // same-file tier
    });
});
```

- [ ] **Step 2.3: Add `receiverType` to `RawCallSite`**

In `src/graph/types.ts`:

```typescript
export interface RawCallSite {
    source: string;
    callName: string;
    line: number;
    diField?: string;
    resolveInClass?: string;
    /** Inferred receiver type (e.g. `'Foo'` for `x.method()` where `x: Foo`). */
    receiverType?: string;
}
```

Also extend `CallResolverStats` to include `receiver: number`.

- [ ] **Step 2.4: Add receiver-type resolution tier in `call-resolver.ts`**

At the start of the per-call loop (before DI / name-based), add:

```typescript
if (call.receiverType) {
    const qualifier = `.${call.callName}`;
    const candidates = symbolTable.lookupGlobal(call.callName).filter((q) => q.includes(`::${call.receiverType}${qualifier}`));
    if (candidates.length === 1) {
        callEdges.push({
            source: fp,
            target: candidates[0],
            callName: call.callName,
            line: call.line,
            confidence: 0.95,
        });
        stats.receiver++;
        continue;
    }
    // If multiple matches (same class in multiple files), still prefer proximity
    // but stay at high confidence since the type is pinned.
    if (candidates.length > 1) {
        const best = pickClosestCandidate(candidates, fp);
        callEdges.push({
            source: fp,
            target: best,
            callName: call.callName,
            line: call.line,
            confidence: 0.9,
            alternatives: candidates.filter((c) => c !== best),
        });
        stats.receiver++;
        continue;
    }
    // No match — fall through to DI / name-based cascade.
}
```

- [ ] **Step 2.5: Implement `extractReceiverTypes` for TypeScript**

In `src/languages/typescript/extractor.ts`, add a new function that walks each function/method body with a two-pass approach:

1. Collect variable-to-type bindings from `variable_declaration` / `lexical_declaration` nodes with either `type_annotation` or `new_expression` initializers.
2. Walk `call_expression` nodes where the callee is a `member_expression` like `x.method`. Look up `x` in the bindings map. If found, record `${fp}:${line}:${column}` → typeName.

Export and wire via `spec.ts` + `engine.ts` dispatcher.

- [ ] **Step 2.6: Wire the extractor output into the pipeline**

In the parser batch code that calls `extractCallsFromFile`, after the call sites are produced:

1. Call `extractReceiverTypesFor(lang, root, fp)` to get the map.
2. For each collected `RawCallSite`, look up its location key in the map; if present, set `call.receiverType = typeName`.

This keeps the resolver signature unchanged — it just sees more `RawCallSite` entries with `receiverType` set.

- [ ] **Step 2.7: Run resolver test — green**

`bun test tests/resolver/receiver-aware.test.ts`

- [ ] **Step 2.8: Implement for 4 more languages: Java, C#, Kotlin, Rust**

These are the easier static languages where scope-local type inference is cheap:

- Java: `Foo x = new Foo()`, `var x = new Foo()` (Java 10+).
- C#: `Foo x = new Foo()`, `var x = new Foo()`.
- Kotlin: `val x = Foo()`, `val x: Foo = ...`.
- Rust: `let x = Foo::new()`, `let x: Foo = ...`.

Add a per-language test case in `tests/resolver/receiver-aware.test.ts` (one per language).

- [ ] **Step 2.9: Implement Go (factory-pattern sniffing)**

Go uses `:=` with type inference; the tree doesn't carry the type. But `x := NewFoo()` (Go idiom for constructors) is a strong signal. If you can read the return type of `NewFoo` from the symbol table's existing function index (already populated), record `x: Foo`. If not (function from another package not yet indexed), skip.

- [ ] **Step 2.10: Implement or no-op for remaining languages**

Python/Swift/Dart/Scala/C++: implement `const x: Type = ...` and `x = Type(...)` sniffing. Ruby/PHP/Elixir: register no-op `extractReceiverTypes` returning an empty map, with a JSDoc note that future work may revisit.

- [ ] **Step 2.11: Full check**

`bun run check` → green. Existing integration tests that produced ambiguous edges (0.30) for cases where a receiver type is inferable will now produce higher-confidence edges — update their assertions.

- [ ] **Step 2.12: Commit**

```bash
git add src/languages/receiver-types.ts src/languages/spec.ts src/languages/engine.ts src/languages/*/extractor.ts src/graph/types.ts src/resolver/call-resolver.ts src/parser tests/languages/receiver-types.test.ts tests/resolver/receiver-aware.test.ts
git commit -m "feat(resolver): receiver-type-aware resolution, scope-local inference in 10 languages"
```

---

## Task 3: Tier distribution in `ParseMetadata`

**Rationale.** A Python project with dynamic dispatch resolves most calls at the 0.30 (ambiguous) tier. A TS project with types resolves most at 0.70+. Consumers of the graph JSON have no way to see this distribution — which matters for trust: "this graph is 80% low-confidence" is useful context for an LLM or a risk model.

Expose the resolver stats already tracked internally into `ParseMetadata.tier_distribution`.

**Files:**
- Modify: `src/graph/types.ts` — add `TierDistribution` type and `tier_distribution?: TierDistribution` to `ParseMetadata`.
- Modify: `src/shared/schemas.ts`.
- Modify: `src/commands/parse.ts` — aggregate per-file resolver stats, attach to metadata.
- Modify: `src/parser/batch.ts` or wherever the resolver stats are emitted — make them accessible to the parse command.
- Tests: assert the metadata has `tier_distribution` with expected keys on a small fixture.

- [ ] **Step 3.1: Add type**

In `src/graph/types.ts`:

```typescript
export interface TierDistribution {
    receiver: number;
    di: number;
    same: number;
    import: number;
    unique: number;
    ambiguous: number;
    noise: number;
    ambiguousNoise: number;
}

export interface ParseMetadata {
    schema_version?: string;
    // ... existing fields ...
    /** Per-tier counts of call resolution outcomes; useful for assessing graph confidence. */
    tier_distribution?: TierDistribution;
}
```

- [ ] **Step 3.2: Mirror in Zod**

`parseMetadataSchema`:

```typescript
tier_distribution: z
    .object({
        receiver: z.number(),
        di: z.number(),
        same: z.number(),
        import: z.number(),
        unique: z.number(),
        ambiguous: z.number(),
        noise: z.number(),
        ambiguousNoise: z.number(),
    })
    .optional(),
```

- [ ] **Step 3.3: Write the failing test**

Parse the existing `sample-repo` fixture via `executeParse`, read the output JSON, assert `metadata.tier_distribution` exists and is an object with all 8 keys summing to a positive number.

- [ ] **Step 3.4: Wire aggregation**

Where `resolveAllCalls` is called (likely `src/parser/batch.ts` or the command handler), accumulate the `stats` object from each file into a total. Pass the total to `executeParse`'s metadata assembly. Set `metadata.tier_distribution` from the accumulated stats.

- [ ] **Step 3.5: Run the test — green**

`bun test tests/commands/parse.test.ts`

- [ ] **Step 3.6: Update README with a note**

In `README.md`'s schema section, document the new field and what it means. Include a brief example showing how to read it:

```bash
kodus-graph parse --all --repo-dir . --out - | jq '.metadata.tier_distribution'
# {"receiver":12,"di":34,"same":189,"import":72,"unique":21,"ambiguous":8,"noise":41,"ambiguousNoise":3}
```

- [ ] **Step 3.7: Full check**

`bun run check` → green.

- [ ] **Step 3.8: Commit**

```bash
git add src/graph/types.ts src/shared/schemas.ts src/commands/parse.ts src/parser tests/commands/ README.md
git commit -m "feat(metadata): expose tier_distribution to surface resolver confidence per repo"
```

---

## Post-Phase Verification

- [ ] **Run full suite**: `bun run check` green.
- [ ] **Sanity-check tier distribution** against a TS repo and a Python repo. Expect TS to show most calls at `same` / `import` / `receiver`, Python to skew `ambiguous` / `noise`. If Python doesn't skew — something's wrong with the noise registration for Python or receiver-type extraction leaked type info it shouldn't have.
- [ ] **Spot-check receiver-aware resolution** on a medium TS file with several `new Foo()` declarations. Before Phase 3: calls to `.update()` produce 0.30 edges. After: they produce 0.95 or 0.90 edges with the right target class.
- [ ] **Document the capabilities table** in `README.md` or `AGENTS.md` — a small matrix of which languages have which capabilities, so contributors can see at a glance what the per-language extractor is expected to produce.
- [ ] **Announce schema bump**: Phase 1 set `SCHEMA_VERSION = '1.0'`. Phase 3 adds new metadata fields and new edge fields (via Phase 2). Bump to `'1.1'` (or `'2.0'` if you consider `tier_distribution` a breaking addition for strict consumers). Document what changed.

## Follow-up (out of this phase, future work)

- **Full type inference** (flow analysis, generics) — would further reduce ambiguous-tier edges in TS/Java. Separate multi-month project.
- **Receiver tracking across files** (constructor return types through imports) — this phase's tracker is scope-local only.
- **Capability-aware risk score** — different weight defaults per language family (e.g. test-gap weight higher for languages without compile-time checks). Would need UX thinking — probably a `--risk-profile <lang-family>` CLI flag.
