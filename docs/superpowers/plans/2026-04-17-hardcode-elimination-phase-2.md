# Hardcode Elimination — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the call resolver more honest and efficient — surface non-picked candidates on ambiguous CALLS edges, move the DI `I→Impl` heuristic out of shared resolver code and into per-language modules, and replace linear scans in the analysis pipeline with a pre-computed graph index.

**Architecture:** Three independent resolver/analysis improvements that build on Phase 1's language-aware foundation. Each is behind a well-defined seam: `alternatives` piggybacks on the existing `RawCallEdge` → `GraphEdge` pipeline; DI heuristics extend the `LanguageExtractors` contract; the graph index is a new pure-function wrapper over `GraphData` that `computeRiskScore` / `computeBlastRadius` can opt into.

**Tech Stack:** TypeScript (strict), Bun runtime, `bun:test`, Zod schemas, ast-grep.

**Prerequisites:**
- Phase 1 merged (per-language noise registry, `languageOfFile`, statistical ambiguous-noise, cyclomatic complexity, configurable risk score).
- Branch: `feat/phase-2-resolver-honesty` off main (or whatever ref contains Phase 1).

**Out of scope (reserved for Phase 3):**
- `LanguageCapabilities` registry.
- Receiver-type-aware call resolution.
- Tier distribution stats in `ParseMetadata`.

---

## File Structure

### New files

- `src/analysis/graph-index.ts` — `GraphIndex` class wrapping a `GraphData` with pre-computed lookups (`nodesByFile`, `edgesByKind`, `nodesByQualifiedName`, `testedFiles`). Exposed from `src/index.ts` for library consumers.
- `tests/analysis/graph-index.test.ts`
- `tests/resolver/alternatives.test.ts`
- `tests/resolver/di-heuristics.test.ts`

### Modified files

- `src/graph/types.ts` — add `alternatives?: string[]` to `RawCallEdge` and `GraphEdge`.
- `src/shared/schemas.ts` — mirror `alternatives` in `graphEdgeSchema`.
- `src/resolver/call-resolver.ts` — record non-picked candidates at the 0.30 tier; remove the hardcoded `if (typeName.startsWith('I'))` block in `resolveDICall`; consult the language's `diHeuristics` method when available; unify DI candidate selection with `pickClosestCandidate`.
- `src/graph/builder.ts` — propagate `alternatives` from `RawCallEdge` to `GraphEdge`.
- `src/languages/spec.ts` — add optional `diHeuristics(typeName, symbolTable): string[]` to `LanguageExtractors`.
- `src/languages/engine.ts` — expose a `getDIHeuristicsFor(language): typeof LanguageExtractors.diHeuristics | null` dispatcher used by the resolver.
- `src/languages/<lang>/extractor.ts` — TS, C#, Java, Go, Kotlin, Scala, PHP implementations of `diHeuristics`. Python, Ruby, Rust, Swift, Dart, Elixir, C opt out (no DI or no naming convention); their extractors omit the method.
- `src/analysis/risk-score.ts` — accept `GraphIndex` as an optional second-form argument; internally build one when only `GraphData` is passed. Replace the three `filter`/`some` linear scans with indexed lookups.
- `src/analysis/blast-radius.ts` — same treatment where applicable.
- `src/analysis/prompt-formatter.ts` and `src/analysis/xml-formatter.ts` — render `alternatives` for low-confidence CALLS edges so LLM reviewers see what the resolver considered.
- `src/commands/analyze.ts`, `src/commands/context.ts` — build a single `GraphIndex` once and pass to both `computeRiskScore` and `computeBlastRadius`.
- `src/index.ts` — re-export `GraphIndex` for library consumers.

---

## Task 1: `alternatives` on ambiguous CALLS edges

**Rationale.** At the 0.30 ambiguous tier the resolver picks a single "closest" candidate and drops the rest silently. An LLM reviewing the graph loses information ("is this `foo.validate` the `UserValidator.validate` or the `OrderValidator.validate`?"). Emitting the alternatives lets the LLM reason about the gap and — if `--format prompt` — see it rendered.

**Files:**
- Modify: `src/graph/types.ts`, `src/shared/schemas.ts`, `src/resolver/call-resolver.ts`, `src/graph/builder.ts`, `src/analysis/prompt-formatter.ts`, `src/analysis/xml-formatter.ts`.
- Create: `tests/resolver/alternatives.test.ts`.

- [ ] **Step 1.1: Write the failing test**

Create `tests/resolver/alternatives.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { ImportMap } from '../../src/resolver/import-map';
import { SymbolTable } from '../../src/resolver/symbol-table';
import '../../src/languages/typescript';

describe('alternatives on ambiguous CALLS', () => {
    it('records the non-picked candidates when ambiguity resolves at 0.30', () => {
        const table = new SymbolTable();
        table.register('src/m1.ts::validate');
        table.register('src/m2.ts::validate');
        table.register('src/m3.ts::validate');
        const { callEdges } = resolveAllCalls(
            [{ source: 'src/caller.ts', callName: 'validate', line: 1 }],
            new Map(),
            table,
            new ImportMap(),
        );
        expect(callEdges.length).toBe(1);
        expect(callEdges[0].confidence).toBe(0.3);
        expect(callEdges[0].alternatives).toBeDefined();
        expect(callEdges[0].alternatives).toHaveLength(2);
        // Ensure the picked target isn't also in alternatives
        for (const alt of callEdges[0].alternatives!) {
            expect(alt).not.toBe(callEdges[0].target);
        }
    });

    it('does NOT populate alternatives at higher-confidence tiers', () => {
        const table = new SymbolTable();
        table.register('src/caller.ts::helper');
        const { callEdges } = resolveAllCalls(
            [{ source: 'src/caller.ts', callName: 'helper', line: 1 }],
            new Map(),
            table,
            new ImportMap(),
        );
        expect(callEdges[0].confidence).toBe(0.85);
        expect(callEdges[0].alternatives).toBeUndefined();
    });
});
```

- [ ] **Step 1.2: Run the test and confirm it fails**

`bun test tests/resolver/alternatives.test.ts`
Expected: fail (`alternatives` is not in `RawCallEdge` yet).

- [ ] **Step 1.3: Add `alternatives?: string[]` to both edge types**

In `src/graph/types.ts`:

```typescript
export interface RawCallEdge {
    source: string;
    target: string;
    callName: string;
    line: number;
    confidence: number;
    /** Non-picked candidates at the ambiguous tier, for LLM consumers. */
    alternatives?: string[];
}

export interface GraphEdge {
    // ... existing fields ...
    confidence?: number;
    alternatives?: string[];
}
```

- [ ] **Step 1.4: Mirror in Zod schema**

In `src/shared/schemas.ts`, update `graphEdgeSchema`:

```typescript
alternatives: z.array(z.string()).optional(),
```

- [ ] **Step 1.5: Record alternatives in `call-resolver.ts`**

In `resolveByName`, at the ambiguous tier (Strategy 4 block), after the `isCodebaseAmbiguous` check passes (i.e. we're keeping the edge), capture non-picked candidates:

```typescript
const candidates = symbolTable.lookupGlobal(callName);
if (candidates.length > 1) {
    if (isCodebaseAmbiguous(callName, symbolTable)) {
        return AMBIGUOUS_NOISE_DROP;
    }
    const best = pickClosestCandidate(candidates, currentFile);
    const alternatives = candidates.filter((c) => c !== best);
    return { target: best, confidence: 0.3, strategy: 'ambiguous', alternatives };
}
```

Update the `ResolveResult` type to include `alternatives?: string[]`. In the main resolution loop, when building the `RawCallEdge`, pass `alternatives` through:

```typescript
callEdges.push({
    source: fp,
    target: resolved.target,
    callName: call.callName,
    line: call.line,
    confidence: resolved.confidence,
    ...(resolved.alternatives && resolved.alternatives.length > 0
        ? { alternatives: resolved.alternatives }
        : {}),
});
```

- [ ] **Step 1.6: Propagate through `builder.ts`**

In `src/graph/builder.ts`, the Raw → GraphEdge conversion site adds:

```typescript
...(edge.alternatives && edge.alternatives.length > 0
    ? { alternatives: edge.alternatives }
    : {}),
```

- [ ] **Step 1.7: Run resolver test — should pass**

`bun test tests/resolver/alternatives.test.ts` → green.

- [ ] **Step 1.8: Render alternatives in `prompt-formatter.ts`**

Locate where CALLS edges are serialized for the prompt (search for `confidence` formatting in `src/analysis/prompt-formatter.ts`). Add conditional rendering:

```typescript
if (edge.confidence !== undefined && edge.confidence <= 0.3 && edge.alternatives?.length) {
    lines.push(`     Alternatives considered: ${edge.alternatives.slice(0, 3).join(', ')}`);
}
```

The exact shape depends on how the formatter currently builds its output — preserve indentation/style of the surrounding block. Cap at 3 alternatives to avoid prompt bloat.

- [ ] **Step 1.9: Same for `xml-formatter.ts`**

Add an `<alternatives>` child element to low-confidence CALLS edges when `alternatives` is set.

- [ ] **Step 1.10: Snapshot tests for prompt/xml output**

Update or add tests in `tests/analysis/prompt-formatter*` / `tests/analysis/xml-formatter*` that exercise an ambiguous edge with alternatives and verify the new line/element appears.

- [ ] **Step 1.11: Full check**

`bun run check` → green.

- [ ] **Step 1.12: Commit**

```bash
git add src/graph/types.ts src/shared/schemas.ts src/resolver/call-resolver.ts src/graph/builder.ts src/analysis/prompt-formatter.ts src/analysis/xml-formatter.ts tests/resolver/alternatives.test.ts tests/analysis/
git commit -m "feat(resolver): emit alternatives on ambiguous CALLS edges for LLM context"
```

---

## Task 2: Per-language DI heuristics

**Rationale.** Today `src/resolver/call-resolver.ts:173-180` hardcodes `typeName.startsWith('I')` to map `IUserService → UserService`. That's TS/C# convention. It fails on:
- Go (interfaces typically have `-er` suffix: `Reader`, `Writer`).
- Java (interface `UserService` → implementation `UserServiceImpl` or `DefaultUserService`).
- Rust/Python/Ruby/Swift (no single naming convention).

Move the heuristic into the language module. The resolver calls into the language for candidate implementations; languages without a naming convention return an empty list.

Also: the DI path in `call-resolver.ts:168` currently picks `candidates[0]` without proximity, unlike `pickClosestCandidate` used elsewhere. Fix that inconsistency at the same time.

**Files:**
- Modify: `src/languages/spec.ts`.
- Modify: `src/languages/engine.ts` (add `getDIHeuristicsFor` dispatcher).
- Modify: `src/languages/<lang>/extractor.ts` for TypeScript, CSharp, Java, Kotlin, Scala, PHP, Go.
- Modify: `src/resolver/call-resolver.ts` (remove hardcoded heuristic, consult language, use `pickClosestCandidate`).
- Create: `tests/resolver/di-heuristics.test.ts`.

- [ ] **Step 2.1: Extend the `LanguageExtractors` contract**

In `src/languages/spec.ts`:

```typescript
import type { SymbolTable } from '../resolver/symbol-table';

export interface LanguageExtractors {
    extract(root: SgNode, fp: string): ExtractionResult;
    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void;
    /**
     * Given a DI type name (e.g. `IUserService`, `UserService`, `Storage`),
     * return candidate implementation names this language would resolve to,
     * in preference order. Empty if the language has no naming convention.
     */
    diHeuristics?(typeName: string): string[];
}
```

Note: the signature takes only the type name, not the symbol table. The caller (resolver) is responsible for looking up each candidate. This keeps language modules pure.

- [ ] **Step 2.2: Write the failing test**

`tests/resolver/di-heuristics.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { getDIHeuristicsFor } from '../../src/languages/engine';
import '../../src/languages/typescript';
import '../../src/languages/go';
import '../../src/languages/java';
import '../../src/languages/python';

describe('per-language DI heuristics', () => {
    it('TypeScript: I-prefix maps to dropped-prefix impl', () => {
        const h = getDIHeuristicsFor('TypeScript');
        expect(h).not.toBeNull();
        expect(h!('IUserService')).toEqual(['UserService']);
        expect(h!('UserService')).toEqual([]); // no I-prefix, no suggestion
        expect(h!('IOrder')).toEqual(['Order']);
    });

    it('Java: bare interface maps to ImplSuffix and DefaultPrefix', () => {
        const h = getDIHeuristicsFor('java');
        expect(h!('UserService')).toEqual(['UserServiceImpl', 'DefaultUserService']);
    });

    it('Go: interface-er suffix maps to implementations dropping -er', () => {
        const h = getDIHeuristicsFor('go');
        // Go idiomatic impl names vary, but the heuristic may suggest stripping -er
        // This test pins the convention the implementer chooses; document in code.
        expect(h!('Reader')).toContain('Read');
    });

    it('Python: no convention, returns empty', () => {
        const h = getDIHeuristicsFor('python');
        // Python extractor may omit diHeuristics entirely — getDIHeuristicsFor returns null.
        // If it returns a function, the function should return [].
        if (h !== null) {
            expect(h('Storage')).toEqual([]);
        }
    });

    it('unknown language returns null', () => {
        expect(getDIHeuristicsFor('Klingon')).toBeNull();
    });
});
```

- [ ] **Step 2.3: Add `getDIHeuristicsFor` dispatcher**

In `src/languages/engine.ts`:

```typescript
const DI_REGISTRY = new Map<string, (typeName: string) => string[]>();

export function registerDIHeuristics(language: string, fn: (typeName: string) => string[]): void {
    DI_REGISTRY.set(language, fn);
}

export function getDIHeuristicsFor(language: string): ((typeName: string) => string[]) | null {
    return DI_REGISTRY.get(language) ?? null;
}
```

(Mirrors the extractor/noise registry pattern.)

Language modules with a heuristic call `registerDIHeuristics` from their extractor.ts's module-level side effects, same pattern as `registerExtractor`.

- [ ] **Step 2.4: Wire TypeScript (and share with C#)**

In `src/languages/typescript/extractor.ts`:

```typescript
import { registerDIHeuristics } from '../engine';

function tsDiHeuristics(typeName: string): string[] {
    if (typeName.length > 1 && typeName[0] === 'I' && typeName[1] === typeName[1].toUpperCase()) {
        return [typeName.substring(1)];
    }
    return [];
}

registerDIHeuristics('TypeScript', tsDiHeuristics);
registerDIHeuristics('Tsx', tsDiHeuristics);
registerDIHeuristics('JavaScript', tsDiHeuristics);
```

In `src/languages/csharp/extractor.ts`: same logic, registered under `'csharp'`.

- [ ] **Step 2.5: Wire Java**

```typescript
function javaDiHeuristics(typeName: string): string[] {
    return [`${typeName}Impl`, `Default${typeName}`];
}
registerDIHeuristics('java', javaDiHeuristics);
```

- [ ] **Step 2.6: Wire Kotlin, Scala, PHP (share Java's convention where appropriate)**

Kotlin: typically `UserServiceImpl` or `DefaultUserService` — reuse Java's heuristic under `'kotlin'`.

Scala: similar — reuse Java's list under `'scala'` as a starting point; adjust if Scala idiom differs in your codebase experience.

PHP: `UserServiceImpl` and `Default` prefix are both common — reuse.

- [ ] **Step 2.7: Wire Go**

Go convention: `Reader` → `FileReader` / `bufferedReader`, or drop the `-er` suffix. Pragmatic heuristic:

```typescript
function goDiHeuristics(typeName: string): string[] {
    const candidates: string[] = [];
    if (typeName.endsWith('er')) {
        candidates.push(typeName.substring(0, typeName.length - 2));
    }
    candidates.push(`Default${typeName}`);
    return candidates;
}
registerDIHeuristics('go', goDiHeuristics);
```

- [ ] **Step 2.8: Do NOT wire heuristics for Python, Ruby, Rust, Swift, Dart, Elixir, C**

These languages either don't have conventional DI-impl naming or their community is split. Leaving them out means `getDIHeuristicsFor('python')` returns `null` and the resolver falls through to the generic DI path (direct name lookup only).

- [ ] **Step 2.9: Rewrite `resolveDICall` in `call-resolver.ts`**

Replace the body (the block with `typeName.startsWith('I')` at line ~173):

```typescript
function resolveDICall(
    fieldName: string,
    methodName: string,
    currentFile: string,
    diMap: Map<string, string> | undefined,
    symbolTable: SymbolTable,
): ResolveResult | null {
    if (!diMap?.has(fieldName)) {
        return null;
    }
    const typeName = diMap.get(fieldName)!;

    // 1) Direct type match — pick closest by proximity (not blindly [0])
    const direct = symbolTable.lookupGlobal(typeName);
    if (direct.length >= 1) {
        const best = pickClosestCandidate(direct, currentFile);
        const typeFile = best.split('::')[0];
        return {
            target: `${typeFile}::${typeName}.${methodName}`,
            confidence: 0.95,
            strategy: 'di',
        };
    }

    // 2) Language-specific implementation heuristics (e.g. IFoo → Foo for TS, Foo → FooImpl for Java)
    const lang = languageOfFile(currentFile);
    const heuristics = lang ? getDIHeuristicsFor(lang) : null;
    if (heuristics) {
        for (const implName of heuristics(typeName)) {
            const implCandidates = symbolTable.lookupGlobal(implName);
            if (implCandidates.length >= 1) {
                const best = pickClosestCandidate(implCandidates, currentFile);
                const implFile = best.split('::')[0];
                return {
                    target: `${implFile}::${implName}.${methodName}`,
                    confidence: 0.9,
                    strategy: 'di',
                };
            }
        }
    }

    return null;
}
```

- [ ] **Step 2.10: Run DI and resolver tests**

`bun test tests/resolver/` → all existing DI tests + the new heuristics test green.

- [ ] **Step 2.11: Full check**

`bun run check` → green.

- [ ] **Step 2.12: Commit**

```bash
git add src/languages/spec.ts src/languages/engine.ts src/languages/*/extractor.ts src/resolver/call-resolver.ts tests/resolver/di-heuristics.test.ts
git commit -m "feat(resolver): per-language DI heuristics, unify DI with proximity picking"
```

---

## Task 3: Pre-computed graph index for analysis

**Rationale.** `src/analysis/risk-score.ts` has three linear scans:
- `graph.nodes.filter(...)` for changed nodes.
- `graph.edges.filter(e => e.kind === 'TESTED_BY')` for tested files.
- `graph.edges.some(e => (INHERITS|IMPLEMENTS) && ...)` for inheritance.

For a 10k-node monorepo with 50k edges, each `analyze` run does O(nodes + 2·edges) work. `computeBlastRadius` has similar scans. Pre-compute once, query cheaply.

**Files:**
- Create: `src/analysis/graph-index.ts`.
- Create: `tests/analysis/graph-index.test.ts`.
- Modify: `src/analysis/risk-score.ts` to accept an optional `GraphIndex`.
- Modify: `src/analysis/blast-radius.ts` to accept an optional `GraphIndex`.
- Modify: `src/commands/analyze.ts`, `src/commands/context.ts` — build one index, pass to both.
- Modify: `src/index.ts` — re-export `GraphIndex`.

- [ ] **Step 3.1: Write the failing test**

`tests/analysis/graph-index.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { GraphIndex } from '../../src/analysis/graph-index';
import type { GraphData } from '../../src/graph/types';

const graph: GraphData = {
    nodes: [
        { kind: 'Function', name: 'a', qualified_name: 'f1.ts::a', file_path: 'f1.ts', line_start: 1, line_end: 5, language: 'TypeScript', is_test: false },
        { kind: 'Function', name: 'b', qualified_name: 'f2.ts::b', file_path: 'f2.ts', line_start: 1, line_end: 5, language: 'TypeScript', is_test: false },
        { kind: 'Function', name: 't', qualified_name: 'f1.test.ts::t', file_path: 'f1.test.ts', line_start: 1, line_end: 5, language: 'TypeScript', is_test: true },
    ],
    edges: [
        { kind: 'CALLS', source_qualified: 'f1.ts::a', target_qualified: 'f2.ts::b', file_path: 'f1.ts', line: 3 },
        { kind: 'TESTED_BY', source_qualified: 'f1.ts', target_qualified: 'f1.test.ts', file_path: 'f1.ts', line: 0 },
        { kind: 'INHERITS', source_qualified: 'f1.ts::Child', target_qualified: 'f2.ts::Parent', file_path: 'f1.ts', line: 1 },
    ],
};

describe('GraphIndex', () => {
    it('nodesByFile groups nodes by file path', () => {
        const idx = new GraphIndex(graph);
        expect(idx.nodesByFile('f1.ts')).toHaveLength(1);
        expect(idx.nodesByFile('f1.ts')[0].name).toBe('a');
        expect(idx.nodesByFile('nonexistent.ts')).toEqual([]);
    });

    it('edgesByKind returns all edges of a given kind', () => {
        const idx = new GraphIndex(graph);
        expect(idx.edgesByKind('CALLS')).toHaveLength(1);
        expect(idx.edgesByKind('TESTED_BY')).toHaveLength(1);
        expect(idx.edgesByKind('CONTAINS')).toEqual([]);
    });

    it('nodeByQualified returns O(1) node lookup', () => {
        const idx = new GraphIndex(graph);
        expect(idx.nodeByQualified('f1.ts::a')?.name).toBe('a');
        expect(idx.nodeByQualified('nonexistent')).toBeUndefined();
    });

    it('testedFiles is the set of source files with TESTED_BY edges', () => {
        const idx = new GraphIndex(graph);
        expect(idx.testedFiles.has('f1.ts')).toBe(true);
        expect(idx.testedFiles.has('f2.ts')).toBe(false);
    });

    it('hasInheritanceInFiles(fileSet) returns true when any INHERITS/IMPLEMENTS edge is in the set', () => {
        const idx = new GraphIndex(graph);
        expect(idx.hasInheritanceInFiles(new Set(['f1.ts']))).toBe(true);
        expect(idx.hasInheritanceInFiles(new Set(['f2.ts']))).toBe(false);
    });
});
```

- [ ] **Step 3.2: Create `src/analysis/graph-index.ts`**

```typescript
import type { EdgeKind, GraphData, GraphEdge, GraphNode } from '../graph/types';

/**
 * Pre-computed graph indexes for O(1) / O(k) lookups during analysis.
 *
 * Build ONCE per analyze/context run; pass to `computeRiskScore`,
 * `computeBlastRadius`, and other analysis functions so they don't each
 * linear-scan `GraphData.nodes` and `GraphData.edges`.
 */
export class GraphIndex {
    private readonly byFile: Map<string, GraphNode[]>;
    private readonly byQualified: Map<string, GraphNode>;
    private readonly byEdgeKind: Map<EdgeKind, GraphEdge[]>;
    public readonly testedFiles: ReadonlySet<string>;

    constructor(public readonly graph: GraphData) {
        this.byFile = new Map();
        this.byQualified = new Map();
        this.byEdgeKind = new Map();

        for (const node of graph.nodes) {
            const arr = this.byFile.get(node.file_path) ?? [];
            arr.push(node);
            this.byFile.set(node.file_path, arr);
            this.byQualified.set(node.qualified_name, node);
        }

        const tested = new Set<string>();
        for (const edge of graph.edges) {
            const arr = this.byEdgeKind.get(edge.kind) ?? [];
            arr.push(edge);
            this.byEdgeKind.set(edge.kind, arr);
            if (edge.kind === 'TESTED_BY') {
                tested.add(edge.file_path);
            }
        }
        this.testedFiles = tested;
    }

    nodesByFile(file: string): readonly GraphNode[] {
        return this.byFile.get(file) ?? [];
    }

    nodeByQualified(qualified: string): GraphNode | undefined {
        return this.byQualified.get(qualified);
    }

    edgesByKind(kind: EdgeKind): readonly GraphEdge[] {
        return this.byEdgeKind.get(kind) ?? [];
    }

    hasInheritanceInFiles(files: ReadonlySet<string>): boolean {
        for (const edge of this.edgesByKind('INHERITS')) {
            if (files.has(edge.file_path)) {
                return true;
            }
        }
        for (const edge of this.edgesByKind('IMPLEMENTS')) {
            if (files.has(edge.file_path)) {
                return true;
            }
        }
        return false;
    }
}
```

- [ ] **Step 3.3: Run graph-index test — green**

`bun test tests/analysis/graph-index.test.ts`

- [ ] **Step 3.4: Refactor `risk-score.ts` to accept an optional `GraphIndex`**

Signature change (additive, backward compatible):

```typescript
export function computeRiskScore(
    graph: GraphData,
    changedFiles: string[],
    blastRadius: BlastRadiusResult,
    options?: { skipTests?: boolean; riskConfig?: RiskConfig; index?: GraphIndex },
): RiskScoreResult {
    const idx = options?.index ?? new GraphIndex(graph);
    // ... rest of function uses idx instead of scanning graph.nodes / graph.edges ...
}
```

Replace:
- `graph.nodes.filter((n) => changedSet.has(n.file_path) && !n.is_test)` with a loop over `changedFiles` collecting `idx.nodesByFile(f).filter(n => !n.is_test)`.
- `new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.file_path))` with `idx.testedFiles`.
- `graph.edges.some(e => (INHERITS|IMPLEMENTS) && changedSet.has(e.file_path))` with `idx.hasInheritanceInFiles(changedSet)`.

Run existing risk-score tests — they must all still pass.

- [ ] **Step 3.5: Refactor `blast-radius.ts` similarly**

If `computeBlastRadius` does its own `graph.edges.filter(e => e.kind === 'CALLS')`-style scans, replace with `idx.edgesByKind('CALLS')`. If it does node-by-name lookups, use `idx.nodeByQualified(...)`. Keep the BFS algorithm unchanged.

- [ ] **Step 3.6: Commands build one index, pass to both**

In `src/commands/analyze.ts`:

```typescript
import { GraphIndex } from '../analysis/graph-index';
// ...
const index = new GraphIndex(graph);
const blast = computeBlastRadius(graph, changedFiles, { index });
const risk = computeRiskScore(graph, changedFiles, blast, { ..., index });
```

Same change in `src/commands/context.ts`.

- [ ] **Step 3.7: Export `GraphIndex` for library consumers**

In `src/index.ts`:

```typescript
export { GraphIndex } from './analysis/graph-index';
```

- [ ] **Step 3.8: Microbenchmark (optional, but do it once)**

Build a scratch script that loads a large graph (e.g. kodus-graph's own `graph.json` run against this repo) and times `computeRiskScore` 100 times with/without pre-built index. Record the delta. Not required to land the task, but worth a 5-minute check to confirm the change pays off.

- [ ] **Step 3.9: Full check**

`bun run check` → green.

- [ ] **Step 3.10: Commit**

```bash
git add src/analysis/graph-index.ts src/analysis/risk-score.ts src/analysis/blast-radius.ts src/commands/analyze.ts src/commands/context.ts src/index.ts tests/analysis/graph-index.test.ts
git commit -m "perf(analysis): pre-computed GraphIndex, drop linear scans in risk+blast"
```

---

## Post-Phase Verification

- [ ] **Run full suite**: `bun run check` green.
- [ ] **Sanity check against a real repo**: run `analyze` and `context` on a medium-sized codebase, compare outputs against pre-Phase-2 runs. Changes expected:
  - Ambiguous CALLS edges now carry `alternatives` (where applicable).
  - DI resolution may pick different targets for interfaces in Go/Java (proximity-aware).
  - No numeric regressions in risk score for identical inputs (index shouldn't change values, only speed).
- [ ] **Update `AGENTS.md`** if a language's DI heuristic is non-obvious (e.g. Go's `-er` suffix stripping) — document in the Coding Standards section so maintainers don't remove it thinking it's dead code.

## Follow-up (Phase 3)

Phase 3 introduces `LanguageCapabilities` (per-language declarations of what the language supports), receiver-type-aware call resolution (light scope-aware type inference in extractors), and tier distribution stats in `ParseMetadata` (exposing the "honesty gap" for dynamic languages).
