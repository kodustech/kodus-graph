# Hardcode Elimination — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cross-language hardcoded heuristics that bias the graph: make `NOISE` per-language, replace `AMBIGUOUS_NOISE` with a statistical signal, replace "lines of code" complexity with cyclomatic complexity, make risk score weights configurable, add schema versioning.

**Architecture:** Per-language concerns (noise lists, branching AST kinds) move into `src/languages/<lang>/`. Codebase-dependent heuristics (ambiguous name detection) are computed at resolve-time from the symbol table. Tunable analysis parameters (risk weights, caps) are externalized to a config object accepted by both the CLI (`--risk-config`) and the programmatic API (`executeAnalyze({ riskConfig })`). The graph JSON gains a `schema_version` field so consumers can detect shape changes.

**Tech Stack:** TypeScript (strict), Bun runtime, `bun:test`, Zod schemas, ast-grep for per-language branching kind detection.

**Out of scope for Phase 1 (reserved for Phase 2/3):**
- DI heuristics per-language (currently `ISomething → Something` is hardcoded in `call-resolver.ts`).
- Preserving `alternatives` on ambiguous CALLS edges.
- Indexed graph analysis (replacing linear scans in `risk-score.ts`).
- Language capabilities registry.
- Receiver-type-aware call resolution.

---

## File Structure

### New files

- `src/shared/constants.ts` — `SCHEMA_VERSION` constant, single source of truth.
- `src/languages/complexity.ts` — generic cyclomatic complexity helper operating on an `SgNode` with a caller-supplied list of branching AST kinds.
- `src/languages/<lang>/noise.ts` — 14 files, one per supported language. Each exports a per-language `NOISE` set and the list of branching AST kinds for cyclomatic complexity.
- `src/languages/language-of-file.ts` — maps a file path to a language key (reuses existing extension table from `src/parser/languages.ts` but exported as a pure function for use by the resolver).
- `src/analysis/risk-config.ts` — `RiskConfig` type, `DEFAULT_RISK_CONFIG`, and `loadRiskConfig(path)` loader with Zod validation.
- `tests/analysis/risk-config.test.ts`, `tests/languages/complexity.test.ts`, `tests/languages/noise.test.ts`, `tests/resolver/statistical-ambiguous.test.ts`, `tests/shared/schema-version.test.ts`.

### Modified files

- `src/graph/types.ts` — add `schema_version` to `ParseMetadata`; add `complexity?: number` to `GraphNode` and `RawFunction`.
- `src/shared/schemas.ts` — mirror the new fields in `parseMetadataSchema` and `graphNodeSchema`.
- `src/languages/spec.ts` — add `complexity: number` to `ExtractedFunction`.
- `src/languages/engine.ts` — pass `complexity` from `ExtractedFunction` to `RawFunction`.
- `src/languages/<lang>/extractor.ts` — 14 files: compute `complexity` using `computeCyclomatic(fn, <lang>BranchKinds)`; register `<lang>NoiseSet` via side-effect import.
- `src/graph/builder.ts` — propagate `complexity` from `RawFunction` to `GraphNode`.
- `src/resolver/call-resolver.ts` — route `NOISE` lookup by `languageOfFile(call.source)`; replace `AMBIGUOUS_NOISE` static set with a threshold check against `symbolTable.countDefinitions(name)`.
- `src/resolver/symbol-table.ts` — add `countDefinitions(name: string): number` method.
- `src/shared/filters.ts` — remove the giant cross-language `NOISE` set and the `AMBIGUOUS_NOISE` set. Keep `SKIP_DIRS`, `SKIP_FILE_PATTERNS`, `isSkippableFile` (they are language-agnostic).
- `src/analysis/risk-score.ts` — accept `RiskConfig`; consume `node.complexity` when available; fall back to `line_end - line_start` only if `complexity` is missing (for old graphs).
- `src/commands/analyze.ts` and `src/commands/context.ts` — accept `riskConfig` in options; pass through to `computeRiskScore`.
- `src/cli.ts` — add `--risk-config <path>` to `analyze` and `context` subcommands.
- `README.md` — fix risk score weight table to reflect the actual code values (0.35 / 0.30 / 0.20 / 0.15).
- `AGENTS.md` — append the hardcode principle in the Architecture Patterns section.

---

## Task 1: Add `schema_version` to parse output

**Files:**
- Create: `src/shared/constants.ts`
- Create: `tests/shared/schema-version.test.ts`
- Modify: `src/graph/types.ts` (interface `ParseMetadata`)
- Modify: `src/shared/schemas.ts` (`parseMetadataSchema`)
- Modify: `src/commands/parse.ts` (write metadata)
- Modify: `src/commands/update.ts` (write metadata on incremental runs)

- [ ] **Step 1.1: Write the failing test**

Create `tests/shared/schema-version.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { SCHEMA_VERSION } from '../../src/shared/constants';
import { parseMetadataSchema } from '../../src/shared/schemas';

describe('schema versioning', () => {
    it('exposes SCHEMA_VERSION as a non-empty string', () => {
        expect(typeof SCHEMA_VERSION).toBe('string');
        expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
    });

    it('parseMetadataSchema accepts schema_version', () => {
        const parsed = parseMetadataSchema.parse({
            repo_dir: '.',
            files_parsed: 1,
            total_nodes: 0,
            total_edges: 0,
            duration_ms: 1,
            parse_errors: 0,
            extract_errors: 0,
            schema_version: SCHEMA_VERSION,
        });
        expect(parsed.schema_version).toBe(SCHEMA_VERSION);
    });

    it('parseMetadataSchema still accepts metadata without schema_version (back-compat)', () => {
        const parsed = parseMetadataSchema.parse({
            repo_dir: '.',
            files_parsed: 1,
            total_nodes: 0,
            total_edges: 0,
            duration_ms: 1,
            parse_errors: 0,
            extract_errors: 0,
        });
        expect(parsed.schema_version).toBeUndefined();
    });
});
```

- [ ] **Step 1.2: Run the test and confirm it fails**

Run: `bun test tests/shared/schema-version.test.ts`
Expected: fail with `Cannot find module '../../src/shared/constants'`.

- [ ] **Step 1.3: Create `src/shared/constants.ts`**

```typescript
/**
 * Schema version written into ParseMetadata. Bump when GraphNode, GraphEdge,
 * or ParseMetadata shape changes in a way consumers must handle explicitly.
 *
 * Format: "major.minor" — bump major on breaking changes, minor on additive.
 */
export const SCHEMA_VERSION = '1.0';
```

- [ ] **Step 1.4: Add `schema_version` to `ParseMetadata`**

In `src/graph/types.ts`, update the `ParseMetadata` interface:

```typescript
export interface ParseMetadata {
    repo_dir: string;
    files_parsed: number;
    total_nodes: number;
    total_edges: number;
    duration_ms: number;
    parse_errors: number;
    extract_errors: number;
    files_unchanged?: number;
    incremental?: boolean;
    /** Kodus-graph schema version. See src/shared/constants.ts. */
    schema_version?: string;
}
```

- [ ] **Step 1.5: Add `schema_version` to `parseMetadataSchema`**

In `src/shared/schemas.ts`:

```typescript
export const parseMetadataSchema = z.object({
    repo_dir: z.string(),
    files_parsed: z.number(),
    total_nodes: z.number(),
    total_edges: z.number(),
    duration_ms: z.number(),
    parse_errors: z.number(),
    extract_errors: z.number(),
    files_unchanged: z.number().optional(),
    incremental: z.boolean().optional(),
    schema_version: z.string().optional(),
});
```

- [ ] **Step 1.6: Run the test and confirm it passes**

Run: `bun test tests/shared/schema-version.test.ts`
Expected: 3 passing.

- [ ] **Step 1.7: Wire `SCHEMA_VERSION` into `executeParse`**

Find the metadata-writing site in `src/commands/parse.ts` (search for `duration_ms`). Add `schema_version: SCHEMA_VERSION` to the metadata object. Import at top: `import { SCHEMA_VERSION } from '../shared/constants';`

- [ ] **Step 1.8: Wire `SCHEMA_VERSION` into `executeUpdate`**

Same treatment in `src/commands/update.ts`. If `update` reuses metadata from the loaded graph, overwrite `schema_version` with the current constant on output (so stale graphs get refreshed).

- [ ] **Step 1.9: Run full test suite**

Run: `bun run check`
Expected: all tests pass, typecheck clean, lint clean.

- [ ] **Step 1.10: Commit**

```bash
git add src/shared/constants.ts src/graph/types.ts src/shared/schemas.ts src/commands/parse.ts src/commands/update.ts tests/shared/schema-version.test.ts
git commit -m "feat(schema): add schema_version to ParseMetadata"
```

---

## Task 2: Configurable risk score weights + fix README drift

**Files:**
- Create: `src/analysis/risk-config.ts`
- Create: `tests/analysis/risk-config.test.ts`
- Modify: `src/analysis/risk-score.ts`
- Modify: `src/commands/analyze.ts`
- Modify: `src/commands/context.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`

- [ ] **Step 2.1: Write the failing test**

Create `tests/analysis/risk-config.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { computeRiskScore } from '../../src/analysis/risk-score';
import { DEFAULT_RISK_CONFIG, type RiskConfig } from '../../src/analysis/risk-config';
import type { BlastRadiusResult, GraphData } from '../../src/graph/types';

const emptyBlast: BlastRadiusResult = { total_functions: 0, total_files: 0, by_depth: {} };
const emptyGraph: GraphData = { nodes: [], edges: [] };

describe('risk-config', () => {
    it('DEFAULT_RISK_CONFIG weights sum to 1.0', () => {
        const w = DEFAULT_RISK_CONFIG.weights;
        expect(w.blast_radius + w.test_gaps + w.complexity + w.inheritance).toBeCloseTo(1.0, 6);
    });

    it('computeRiskScore uses default weights when no config passed', () => {
        const result = computeRiskScore(emptyGraph, [], emptyBlast);
        expect(result.factors.blast_radius.weight).toBe(DEFAULT_RISK_CONFIG.weights.blast_radius);
    });

    it('computeRiskScore honors custom weights', () => {
        const cfg: RiskConfig = {
            weights: { blast_radius: 0.5, test_gaps: 0.2, complexity: 0.2, inheritance: 0.1 },
            caps: DEFAULT_RISK_CONFIG.caps,
        };
        const result = computeRiskScore(emptyGraph, [], emptyBlast, { riskConfig: cfg });
        expect(result.factors.blast_radius.weight).toBe(0.5);
    });

    it('rejects configs whose weights do not sum to 1.0', () => {
        const cfg = {
            weights: { blast_radius: 0.5, test_gaps: 0.5, complexity: 0.5, inheritance: 0.5 },
            caps: DEFAULT_RISK_CONFIG.caps,
        } as RiskConfig;
        expect(() => computeRiskScore(emptyGraph, [], emptyBlast, { riskConfig: cfg })).toThrow(
            /weights must sum to 1/,
        );
    });
});
```

- [ ] **Step 2.2: Run the test and confirm it fails**

Run: `bun test tests/analysis/risk-config.test.ts`
Expected: fail with `Cannot find module '../../src/analysis/risk-config'`.

- [ ] **Step 2.3: Create `src/analysis/risk-config.ts`**

```typescript
import { readFileSync } from 'fs';
import { z } from 'zod';

export interface RiskWeights {
    blast_radius: number;
    test_gaps: number;
    complexity: number;
    inheritance: number;
}

export interface RiskCaps {
    /** Blast radius normalization cap (total functions). */
    blast_functions: number;
    /** Cyclomatic complexity normalization cap. */
    complexity: number;
}

export interface RiskConfig {
    weights: RiskWeights;
    caps: RiskCaps;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
    weights: {
        blast_radius: 0.35,
        test_gaps: 0.3,
        complexity: 0.2,
        inheritance: 0.15,
    },
    caps: {
        blast_functions: 20,
        complexity: 10,
    },
};

const riskConfigSchema = z.object({
    weights: z.object({
        blast_radius: z.number().min(0).max(1),
        test_gaps: z.number().min(0).max(1),
        complexity: z.number().min(0).max(1),
        inheritance: z.number().min(0).max(1),
    }),
    caps: z.object({
        blast_functions: z.number().positive(),
        complexity: z.number().positive(),
    }),
});

export function validateRiskConfig(cfg: RiskConfig): void {
    const w = cfg.weights;
    const sum = w.blast_radius + w.test_gaps + w.complexity + w.inheritance;
    if (Math.abs(sum - 1.0) > 1e-6) {
        throw new Error(`risk config weights must sum to 1.0 (got ${sum.toFixed(4)})`);
    }
}

export function loadRiskConfig(path: string): RiskConfig {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const parsed = riskConfigSchema.parse(raw);
    validateRiskConfig(parsed);
    return parsed;
}
```

- [ ] **Step 2.4: Update `computeRiskScore` signature to accept `options.riskConfig`**

In `src/analysis/risk-score.ts`, replace the function signature and body. Reference the caps and weights from config. The current hardcoded `/ 20`, `/ 50`, `* 0.35` etc. all come from config. Complexity for now still uses `line_end - line_start` — Task 5 swaps it to real cyclomatic complexity.

```typescript
import type { BlastRadiusResult, GraphData, RiskScoreResult } from '../graph/types';
import { DEFAULT_RISK_CONFIG, type RiskConfig, validateRiskConfig } from './risk-config';

export function computeRiskScore(
    graph: GraphData,
    changedFiles: string[],
    blastRadius: BlastRadiusResult,
    options?: { skipTests?: boolean; riskConfig?: RiskConfig },
): RiskScoreResult {
    const cfg = options?.riskConfig ?? DEFAULT_RISK_CONFIG;
    validateRiskConfig(cfg);
    const { weights, caps } = cfg;

    const changedSet = new Set(changedFiles);
    const changedNodes = graph.nodes.filter((n) => changedSet.has(n.file_path) && !n.is_test);

    // Factor 1: Blast radius
    const brValue = Math.min(blastRadius.total_functions / caps.blast_functions, 1);

    // Factor 2: Test gaps
    let tgValue = 0;
    let untestedCount = 0;
    const changedFunctions = changedNodes.filter((n) => n.kind === 'Function' || n.kind === 'Method');
    if (!options?.skipTests) {
        const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.file_path));
        untestedCount = changedFunctions.filter((n) => !testedFiles.has(n.file_path)).length;
        tgValue = changedFunctions.length > 0 ? untestedCount / changedFunctions.length : 0;
    }

    // Factor 3: Complexity (Task 5 will swap this to cyclomatic; kept as lines for this task)
    const avgSize =
        changedNodes.length > 0
            ? changedNodes.reduce((s, n) => s + (n.line_end - n.line_start), 0) / changedNodes.length
            : 0;
    const cxValue = Math.min(avgSize / 50, 1);

    // Factor 4: Inheritance
    const hasInheritance = graph.edges.some(
        (e) => (e.kind === 'INHERITS' || e.kind === 'IMPLEMENTS') && changedSet.has(e.file_path),
    );
    const ihValue = hasInheritance ? 1 : 0;

    const score =
        brValue * weights.blast_radius +
        tgValue * weights.test_gaps +
        cxValue * weights.complexity +
        ihValue * weights.inheritance;
    const level = score >= 0.6 ? 'HIGH' : score >= 0.3 ? 'MEDIUM' : 'LOW';

    return {
        level,
        score: Math.round(score * 100) / 100,
        factors: {
            blast_radius: {
                weight: weights.blast_radius,
                value: Math.round(brValue * 100) / 100,
                detail: `${blastRadius.total_functions} functions, ${blastRadius.total_files} files`,
            },
            test_gaps: {
                weight: weights.test_gaps,
                value: Math.round(tgValue * 100) / 100,
                detail: `${untestedCount}/${changedFunctions.length} untested`,
            },
            complexity: {
                weight: weights.complexity,
                value: Math.round(cxValue * 100) / 100,
                detail: `avg ${Math.round(avgSize)} lines`,
            },
            inheritance: {
                weight: weights.inheritance,
                value: ihValue,
                detail: hasInheritance ? 'has inheritance' : 'no inheritance',
            },
        },
    };
}
```

- [ ] **Step 2.5: Run the tests and confirm they pass**

Run: `bun test tests/analysis/risk-config.test.ts tests/analysis/risk-score*`
Expected: all passing.

- [ ] **Step 2.6: Thread `riskConfig` through `executeAnalyze` and `executeContext`**

In `src/commands/analyze.ts`, add `riskConfig?: RiskConfig` to the options interface. Load it conditionally:

```typescript
import { loadRiskConfig, type RiskConfig } from '../analysis/risk-config';

export interface ExecuteAnalyzeOptions {
    repoDir: string;
    files: string[];
    graph?: string;
    out: string;
    skipTests: boolean;
    riskConfig?: RiskConfig | string; // object for library use, path for CLI
}
```

In the handler, normalize:

```typescript
const riskConfigResolved: RiskConfig | undefined =
    typeof options.riskConfig === 'string'
        ? loadRiskConfig(options.riskConfig)
        : options.riskConfig;
```

Pass `riskConfig: riskConfigResolved` into `computeRiskScore`. Do the same in `src/commands/context.ts`.

- [ ] **Step 2.7: Add `--risk-config <path>` CLI flag**

In `src/cli.ts`, add to both `analyze` and `context` commands:

```typescript
.option('--risk-config <path>', 'Path to JSON risk-score config (weights + caps)')
```

And in the `.action(...)` body pass `riskConfig: opts.riskConfig`.

- [ ] **Step 2.8: Fix README.md drift**

In `README.md`, locate the risk score factors table (currently lists 40% / 30% / 15% / 15%). Replace with:

```markdown
The score is computed from 4 factors (defaults — override via `--risk-config`):
- **blast_radius** (35%) — how many functions are affected
- **test_gaps** (30%) — how many changed functions lack tests
- **complexity** (20%) — average cyclomatic complexity of changed functions
- **inheritance** (15%) — whether class hierarchy is affected
```

- [ ] **Step 2.9: Run full check**

Run: `bun run check`
Expected: all green.

- [ ] **Step 2.10: Commit**

```bash
git add src/analysis/risk-config.ts src/analysis/risk-score.ts src/commands/analyze.ts src/commands/context.ts src/cli.ts tests/analysis/risk-config.test.ts README.md
git commit -m "feat(risk): make risk-score weights and caps configurable"
```

---

## Task 3: Cyclomatic complexity helper + wire through types

**Files:**
- Create: `src/languages/complexity.ts`
- Create: `tests/languages/complexity.test.ts`
- Modify: `src/languages/spec.ts`
- Modify: `src/graph/types.ts`
- Modify: `src/shared/schemas.ts`
- Modify: `src/languages/engine.ts`
- Modify: `src/graph/builder.ts`

- [ ] **Step 3.1: Write the failing test**

Create `tests/languages/complexity.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import { computeCyclomatic } from '../../src/languages/complexity';

const TS_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'catch_clause',
    'ternary_expression',
    'case',
];

describe('computeCyclomatic', () => {
    it('returns 1 for a function with no branches', async () => {
        const tree = await parseAsync('TypeScript', 'function f() { return 1; }');
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(fn).not.toBeNull();
        expect(computeCyclomatic(fn!, TS_BRANCH_KINDS)).toBe(1);
    });

    it('counts if + else-if + while as 3 extra paths -> complexity 4', async () => {
        const src = `function f(x: number) {
            if (x > 0) { return 1; }
            else if (x < 0) { return -1; }
            while (x === 0) { x++; }
            return 0;
        }`;
        const tree = await parseAsync('TypeScript', src);
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(computeCyclomatic(fn!, TS_BRANCH_KINDS)).toBe(4);
    });

    it('returns 1 when no branch kinds are configured', async () => {
        const tree = await parseAsync('TypeScript', 'function f() { if (true) return; }');
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(computeCyclomatic(fn!, [])).toBe(1);
    });
});
```

- [ ] **Step 3.2: Run the test and confirm it fails**

Run: `bun test tests/languages/complexity.test.ts`
Expected: fail with `Cannot find module '../../src/languages/complexity'`.

- [ ] **Step 3.3: Create `src/languages/complexity.ts`**

```typescript
import type { SgNode } from '@ast-grep/napi';

/**
 * McCabe cyclomatic complexity: 1 + number of decision points.
 *
 * Each language passes its own list of branching AST kinds (if, for, while,
 * switch-case, catch, ternary, etc.). This keeps the helper language-agnostic
 * while letting each language define what counts as a decision point.
 *
 * The passed-in `fn` is a function/method node; we traverse its subtree and
 * count matches.
 */
export function computeCyclomatic(fn: SgNode, branchKinds: readonly string[]): number {
    if (branchKinds.length === 0) {
        return 1;
    }
    const kindSet = new Set(branchKinds);
    let count = 0;
    const stack: SgNode[] = [fn];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (kindSet.has(String(node.kind()))) {
            count++;
        }
        for (const child of node.children()) {
            stack.push(child);
        }
    }
    return 1 + count;
}
```

- [ ] **Step 3.4: Run the test and confirm it passes**

Run: `bun test tests/languages/complexity.test.ts`
Expected: 3 passing.

- [ ] **Step 3.5: Add `complexity` to `ExtractedFunction`**

In `src/languages/spec.ts`:

```typescript
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
    is_exported: boolean;
    is_async: boolean;
    decorators: string[];
    throws: string[];
    /** McCabe cyclomatic complexity. 1 = straight-line code. */
    complexity: number;
}
```

- [ ] **Step 3.6: Add `complexity` to `GraphNode` and `RawFunction`**

In `src/graph/types.ts`:

```typescript
export interface GraphNode {
    // ... existing fields ...
    complexity?: number;
}

export interface RawFunction {
    // ... existing fields ...
    complexity?: number;
}
```

- [ ] **Step 3.7: Mirror in Zod schema**

In `src/shared/schemas.ts` add to `graphNodeSchema`:

```typescript
complexity: z.number().optional(),
```

- [ ] **Step 3.8: Propagate through `engine.ts`**

In `src/languages/engine.ts`, find the spot where `Extracted*` is converted to `Raw*`. Add `complexity: extractedFn.complexity` to the conversion (the exact property-assignment spelling depends on that file — use the same pattern as `is_async`, `decorators`, `throws`).

- [ ] **Step 3.9: Propagate through `builder.ts`**

In `src/graph/builder.ts`, find the spot where `RawFunction` is converted to `GraphNode`. Add `complexity: fn.complexity` to the conversion (same pattern as neighbouring fields).

- [ ] **Step 3.10: Run full check — expect existing language extractors to still compile because `complexity` is `?` on `RawFunction` / `GraphNode`, but Task 4 will make it required at the `ExtractedFunction` layer once all extractors are updated**

Run: `bun run typecheck`
Expected: **fails** until Task 4 lands, because `ExtractedFunction.complexity` is non-optional but no extractor populates it.

Make `ExtractedFunction.complexity` optional for this commit — we'll tighten it to required at the end of Task 4:

```typescript
// src/languages/spec.ts
complexity?: number; // TEMP: required once all extractors populate it (end of Task 4)
```

- [ ] **Step 3.11: Run full check**

Run: `bun run check`
Expected: green.

- [ ] **Step 3.12: Commit**

```bash
git add src/languages/complexity.ts tests/languages/complexity.test.ts src/languages/spec.ts src/graph/types.ts src/shared/schemas.ts src/languages/engine.ts src/graph/builder.ts
git commit -m "feat(complexity): add cyclomatic helper and thread field through types"
```

---

## Task 4: Populate `complexity` in all 14 language extractors

**Files (14 extractors):**
- Modify: `src/languages/typescript/extractor.ts`
- Modify: `src/languages/python/extractor.ts`
- Modify: `src/languages/ruby/extractor.ts`
- Modify: `src/languages/go/extractor.ts`
- Modify: `src/languages/java/extractor.ts`
- Modify: `src/languages/kotlin/extractor.ts`
- Modify: `src/languages/rust/extractor.ts`
- Modify: `src/languages/csharp/extractor.ts`
- Modify: `src/languages/php/extractor.ts`
- Modify: `src/languages/swift/extractor.ts`
- Modify: `src/languages/dart/extractor.ts`
- Modify: `src/languages/scala/extractor.ts`
- Modify: `src/languages/c/extractor.ts`
- Modify: `src/languages/elixir/extractor.ts`
- Create: `tests/languages/complexity-integration.test.ts`

- [ ] **Step 4.1: Write an integration test that runs extractors on fixtures and asserts `complexity` is populated**

Create `tests/languages/complexity-integration.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractAll } from '../../src/parser/extractor';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures');

// One sentinel fixture per language — pick a file that contains at least one
// function with branching. Adjust paths to match what exists in tests/fixtures/.
const CASES: { lang: string; path: string }[] = [
    { lang: 'TypeScript', path: 'typescript/sample.ts' },
    { lang: 'Python', path: 'python/sample.py' },
    { lang: 'Ruby', path: 'ruby/sample.rb' },
    { lang: 'Go', path: 'go/sample.go' },
    { lang: 'Java', path: 'java/Sample.java' },
    { lang: 'Kotlin', path: 'kotlin/Sample.kt' },
    { lang: 'Rust', path: 'rust/sample.rs' },
    { lang: 'CSharp', path: 'csharp/Sample.cs' },
    { lang: 'Php', path: 'php/Sample.php' },
    { lang: 'Swift', path: 'swift/Sample.swift' },
    { lang: 'Dart', path: 'dart/sample.dart' },
    { lang: 'Scala', path: 'scala/Sample.scala' },
    { lang: 'C', path: 'c/sample.c' },
    { lang: 'Elixir', path: 'elixir/sample.ex' },
];

describe('complexity is populated per language', () => {
    for (const c of CASES) {
        it(`${c.lang} extractor sets complexity on every function`, async () => {
            const src = readFileSync(join(FIXTURES_DIR, c.path), 'utf-8');
            const raw = await extractAll(c.lang, src, c.path);
            expect(raw.functions.length).toBeGreaterThan(0);
            for (const fn of raw.functions) {
                expect(typeof fn.complexity).toBe('number');
                expect(fn.complexity).toBeGreaterThanOrEqual(1);
            }
        });
    }
});
```

> **Note:** If `extractAll` is not the actual exported symbol in `src/parser/extractor.ts`, use the real one (the engine-dispatch call). Adjust fixture paths to match files that exist in `tests/fixtures/`. If a fixture is missing for a language, either add a minimal one (5-10 lines with one branch) or skip that case and create the fixture as part of this task.

- [ ] **Step 4.2: Run test — expect it to fail for every language**

Run: `bun test tests/languages/complexity-integration.test.ts`
Expected: 14 failures (complexity undefined on functions).

- [ ] **Step 4.3: Wire TypeScript extractor**

In `src/languages/typescript/extractor.ts`:

1. Add import at top:
```typescript
import { computeCyclomatic } from '../complexity';

const TS_BRANCH_KINDS = [
    'if_statement',
    'else_clause',
    'for_statement',
    'for_in_statement',
    'for_of_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
    'ternary_expression',
] as const;
```

2. In the function-extraction block, compute and set:
```typescript
complexity: computeCyclomatic(fnNode, TS_BRANCH_KINDS),
```

- [ ] **Step 4.4: Run the TS case — it should pass, others still fail**

Run: `bun test tests/languages/complexity-integration.test.ts -t TypeScript`
Expected: pass.

- [ ] **Step 4.5: Wire Python extractor**

In `src/languages/python/extractor.ts`:

```typescript
import { computeCyclomatic } from '../complexity';

const PY_BRANCH_KINDS = [
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'except_clause',
    'conditional_expression',
    'match_statement',
    'case_clause',
] as const;

// ... complexity: computeCyclomatic(fnNode, PY_BRANCH_KINDS),
```

- [ ] **Step 4.6: Wire Ruby extractor**

```typescript
const RB_BRANCH_KINDS = [
    'if',
    'elsif',
    'unless',
    'while',
    'until',
    'for',
    'case',
    'when',
    'rescue',
    'ternary',
] as const;
```

- [ ] **Step 4.7: Wire Go extractor**

```typescript
const GO_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'switch_statement',
    'expression_case',
    'type_case',
    'type_switch_statement',
    'select_statement',
    'communication_case',
] as const;
```

- [ ] **Step 4.8: Wire Java extractor**

```typescript
const JAVA_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'enhanced_for_statement',
    'while_statement',
    'do_statement',
    'switch_label',
    'catch_clause',
    'ternary_expression',
] as const;
```

- [ ] **Step 4.9: Wire Kotlin extractor**

```typescript
const KT_BRANCH_KINDS = [
    'if_expression',
    'for_statement',
    'while_statement',
    'do_while_statement',
    'when_entry',
    'catch_block',
] as const;
```

- [ ] **Step 4.10: Wire Rust extractor**

```typescript
const RS_BRANCH_KINDS = [
    'if_expression',
    'match_arm',
    'for_expression',
    'while_expression',
    'loop_expression',
    'if_let_expression',
    'while_let_expression',
] as const;
```

- [ ] **Step 4.11: Wire C# extractor**

```typescript
const CS_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'switch_section',
    'catch_clause',
    'conditional_expression',
    'conditional_access_expression',
] as const;
```

- [ ] **Step 4.12: Wire PHP extractor**

```typescript
const PHP_BRANCH_KINDS = [
    'if_statement',
    'else_if_clause',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'switch_block',
    'case_statement',
    'catch_clause',
    'conditional_expression',
] as const;
```

- [ ] **Step 4.13: Wire Swift extractor**

```typescript
const SW_BRANCH_KINDS = [
    'if_statement',
    'guard_statement',
    'for_statement',
    'while_statement',
    'repeat_while_statement',
    'switch_statement',
    'case_statement',
    'catch_clause',
    'ternary_expression',
] as const;
```

- [ ] **Step 4.14: Wire Dart extractor**

```typescript
const DART_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'case_statement',
    'catch_clause',
    'conditional_expression',
] as const;
```

- [ ] **Step 4.15: Wire Scala extractor**

```typescript
const SCALA_BRANCH_KINDS = [
    'if_expression',
    'for_expression',
    'while_expression',
    'do_while_expression',
    'match_expression',
    'case_clause',
    'catch_clause',
] as const;
```

- [ ] **Step 4.16: Wire C/C++ extractor**

```typescript
const C_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'case_statement',
    'conditional_expression',
    'catch_clause',
] as const;
```

- [ ] **Step 4.17: Wire Elixir extractor**

```typescript
const EX_BRANCH_KINDS = [
    'case',
    'cond',
    'if',
    'unless',
    'with',
    'rescue',
    'catch',
] as const;
```

> **Verification note:** Elixir's ast-grep kinds may differ. Before wiring, print a sample tree via `parseAsync('Elixir', src).root().children()` in a throwaway script and adjust kinds to match. Same verification applies if any other language's branch kinds don't produce `> 1` complexity on a fixture with branches.

- [ ] **Step 4.18: Run the integration test — all 14 should pass**

Run: `bun test tests/languages/complexity-integration.test.ts`
Expected: 14 passing.

- [ ] **Step 4.19: Make `ExtractedFunction.complexity` required**

Revert the `?` from Step 3.10. In `src/languages/spec.ts`:

```typescript
complexity: number; // now required — all extractors populate it
```

- [ ] **Step 4.20: Run full check**

Run: `bun run check`
Expected: green.

- [ ] **Step 4.21: Commit**

```bash
git add src/languages tests/languages/complexity-integration.test.ts
git commit -m "feat(complexity): populate cyclomatic complexity in all 14 extractors"
```

---

## Task 5: Use cyclomatic complexity in risk score

**Files:**
- Modify: `src/analysis/risk-score.ts`
- Modify: `tests/analysis/risk-score*` (add a test that asserts high-complexity changed code raises the cx factor)

- [ ] **Step 5.1: Write the failing test**

In a new or existing risk-score test file, add:

```typescript
it('uses GraphNode.complexity for the complexity factor when available', () => {
    const graph: GraphData = {
        nodes: [
            {
                kind: 'Function',
                name: 'big',
                qualified_name: 'a.ts::big',
                file_path: 'a.ts',
                line_start: 1,
                line_end: 5, // small by lines
                language: 'TypeScript',
                is_test: false,
                complexity: 20, // but high cyclomatic
            },
        ],
        edges: [],
    };
    const blast: BlastRadiusResult = { total_functions: 0, total_files: 0, by_depth: {} };
    const result = computeRiskScore(graph, ['a.ts'], blast);
    expect(result.factors.complexity.value).toBe(1); // capped at 1
    expect(result.factors.complexity.detail).toMatch(/avg cyclomatic 20/);
});

it('falls back to lines when complexity is missing', () => {
    const graph: GraphData = {
        nodes: [
            {
                kind: 'Function',
                name: 'old',
                qualified_name: 'a.ts::old',
                file_path: 'a.ts',
                line_start: 1,
                line_end: 101, // 100 lines
                language: 'TypeScript',
                is_test: false,
                // no complexity field — legacy node
            },
        ],
        edges: [],
    };
    const blast: BlastRadiusResult = { total_functions: 0, total_files: 0, by_depth: {} };
    const result = computeRiskScore(graph, ['a.ts'], blast);
    expect(result.factors.complexity.detail).toMatch(/avg 100 lines \(legacy\)/);
});
```

- [ ] **Step 5.2: Run the test and confirm it fails**

Run: `bun test tests/analysis/risk-score*`
Expected: two new failures.

- [ ] **Step 5.3: Swap the complexity factor implementation**

In `src/analysis/risk-score.ts`, replace the `Factor 3` block:

```typescript
// Factor 3: Complexity — prefer real cyclomatic, fall back to LoC for legacy graphs
const nodesWithComplexity = changedNodes.filter((n) => typeof n.complexity === 'number');
let cxValue: number;
let cxDetail: string;
if (nodesWithComplexity.length > 0) {
    const avgCx =
        nodesWithComplexity.reduce((s, n) => s + (n.complexity ?? 0), 0) / nodesWithComplexity.length;
    cxValue = Math.min(avgCx / caps.complexity, 1);
    cxDetail = `avg cyclomatic ${Math.round(avgCx)}`;
} else {
    const avgSize =
        changedNodes.length > 0
            ? changedNodes.reduce((s, n) => s + (n.line_end - n.line_start), 0) / changedNodes.length
            : 0;
    cxValue = Math.min(avgSize / 50, 1);
    cxDetail = `avg ${Math.round(avgSize)} lines (legacy)`;
}
```

Update the `factors.complexity` object to use `cxDetail`.

- [ ] **Step 5.4: Run the test and confirm it passes**

Run: `bun test tests/analysis/risk-score*`
Expected: green.

- [ ] **Step 5.5: Run full check**

Run: `bun run check`
Expected: green.

- [ ] **Step 5.6: Commit**

```bash
git add src/analysis/risk-score.ts tests/analysis/
git commit -m "feat(risk): use cyclomatic complexity in risk score, fall back to LoC for legacy graphs"
```

---

## Task 6: Per-language NOISE modules

**Files:**
- Create: `src/languages/<lang>/noise.ts` (14 files)
- Create: `src/languages/noise-registry.ts` (central registry — languages register their noise via side-effect)
- Modify: `src/languages/<lang>/index.ts` (14 files — each imports `./noise` for side-effect)
- Create: `tests/languages/noise.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `tests/languages/noise.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { getNoiseFor, registerNoise } from '../../src/languages/noise-registry';
// Side-effect imports to trigger registration — mirrors how engine.ts pulls extractors.
import '../../src/languages/typescript';
import '../../src/languages/python';
import '../../src/languages/ruby';
import '../../src/languages/go';
import '../../src/languages/java';

describe('per-language NOISE registry', () => {
    it('returns the TypeScript noise set for a .ts file', () => {
        const noise = getNoiseFor('TypeScript');
        expect(noise.has('log')).toBe(true);
        expect(noise.has('useEffect')).toBe(true);
        // Python-only noise should NOT appear in TS list
        expect(noise.has('print')).toBe(false);
    });

    it('returns the Python noise set for a .py file', () => {
        const noise = getNoiseFor('Python');
        expect(noise.has('print')).toBe(true);
        expect(noise.has('enumerate')).toBe(true);
        // TS-only noise should NOT appear in Python list
        expect(noise.has('useEffect')).toBe(false);
    });

    it('returns an empty set when language is unregistered', () => {
        expect(getNoiseFor('Klingon').size).toBe(0);
    });

    it('registerNoise replaces previous entry for the same language', () => {
        registerNoise('TestLang', new Set(['a']));
        registerNoise('TestLang', new Set(['b']));
        expect(getNoiseFor('TestLang').has('b')).toBe(true);
        expect(getNoiseFor('TestLang').has('a')).toBe(false);
    });
});
```

- [ ] **Step 6.2: Run the test and confirm it fails**

Run: `bun test tests/languages/noise.test.ts`
Expected: fail with `Cannot find module '../../src/languages/noise-registry'`.

- [ ] **Step 6.3: Create the registry**

`src/languages/noise-registry.ts`:

```typescript
/**
 * Per-language noise registry.
 *
 * Each language module populates its entry via `registerNoise()` at import time
 * (same pattern as `registerExtractor`). The resolver looks up noise by the
 * language of the call site, not globally.
 */

const REGISTRY = new Map<string, ReadonlySet<string>>();
const EMPTY: ReadonlySet<string> = new Set();

export function registerNoise(language: string, names: ReadonlySet<string>): void {
    REGISTRY.set(language, names);
}

export function getNoiseFor(language: string): ReadonlySet<string> {
    return REGISTRY.get(language) ?? EMPTY;
}

/** Used by tests that want to reset state between cases. */
export function __clearNoiseRegistryForTests(): void {
    REGISTRY.clear();
}
```

- [ ] **Step 6.4: Split current `NOISE` by language into per-language files**

Use the existing `src/shared/filters.ts:39-243` as the source material. Each language file lives at `src/languages/<lang>/noise.ts` and:

1. Defines its own `NOISE` set (only names that make sense in that language).
2. Calls `registerNoise(<language key>, NOISE)` on import.

The language keys must match the strings used by the ast-grep registration in `src/parser/languages.ts` (e.g. `'TypeScript'`, `'JavaScript'`, `'Python'`, `'Ruby'`, `'Go'`, `'Java'`, `'Kotlin'`, `'Rust'`, `'CSharp'`, `'Php'`, `'Swift'`, `'Dart'`, `'Scala'`, `'C'`, `'Cpp'`, `'Elixir'`).

Template for `src/languages/typescript/noise.ts`:

```typescript
import { registerNoise } from '../noise-registry';

/**
 * Standard-library / framework names that are NOT worth resolving as user calls.
 * Keep this TS/JS-specific — Python/Ruby/Go equivalents live in their own
 * noise.ts files.
 */
export const TS_NOISE: ReadonlySet<string> = new Set([
    // Console
    'log', 'error', 'warn', 'info', 'debug', 'trace',
    // Array prototype
    'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'map', 'filter',
    'reduce', 'forEach', 'find', 'findIndex', 'some', 'every', 'flat',
    'flatMap', 'sort', 'reverse', 'join', 'concat', 'includes', 'indexOf',
    'lastIndexOf',
    // String prototype
    'split', 'trim', 'replace', 'match', 'startsWith', 'endsWith', 'charAt',
    'substring', 'toLowerCase', 'toUpperCase',
    // Object static
    'keys', 'values', 'entries', 'assign', 'freeze', 'create', 'stringify',
    'parse',
    // Number parsing
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'isArray',
    // Promise
    'resolve', 'reject', 'all', 'allSettled', 'race', 'any', 'then', 'catch',
    'finally',
    // Map/Set
    'get', 'set', 'has', 'delete', 'clear', 'add',
    // Iterator
    'next', 'return', 'throw',
    // Timers + binding
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'call', 'apply', 'bind', 'length',
    // React hooks (common enough to be cross-project noise)
    'createElement', 'useState', 'useEffect', 'useRef', 'useCallback',
    'useMemo', 'useContext', 'useReducer', 'render',
    // Test helpers
    'expect', 'toBe', 'toEqual', 'toBeDefined', 'toBeNull', 'toBeUndefined',
    'toBeTruthy', 'toBeFalsy', 'toContain', 'toHaveLength', 'toThrow',
    'toHaveBeenCalled', 'toHaveBeenCalledWith', 'toMatchObject',
    'toHaveBeenCalledTimes', 'toHaveProperty',
    'describe', 'it', 'test', 'beforeEach', 'afterEach', 'beforeAll',
    'afterAll', 'fn', 'spyOn', 'mock', 'mockResolvedValue',
    'mockReturnValue', 'mockImplementation', 'mockReturnThis',
    // Globals (constructor-like, almost always builtin)
    'console', 'Math', 'Date', 'JSON', 'Object', 'Array', 'String', 'Number',
    'Boolean', 'Promise', 'Error', 'Map', 'Set', 'RegExp', 'Buffer', 'process',
    'require',
]);

registerNoise('TypeScript', TS_NOISE);
registerNoise('JavaScript', TS_NOISE); // JS shares TS's noise
registerNoise('Tsx', TS_NOISE);
```

Create analogous files for each language, picking only the lines from the current global `NOISE` that belong to that language:

- `src/languages/python/noise.ts` — `print`, `len`, `range`, `enumerate`, `zip`, `isinstance`, `type`, `super`, `self`, `cls`, `None`, `True`, `False`, `append`, `extend`, `insert`, `remove`, `update`, `items`, `format`, `strip`, `upper`, `lower`.
- `src/languages/ruby/noise.ts` — `puts`, `raise`, `yield`, `each`, `do`, `end`, `attr_accessor`, `attr_reader`, `attr_writer`, `respond_to`, `render`, `redirect_to`, `before_action`, `after_action`, `validates`, `has_many`, `belongs_to`, `has_one`, `new`, `initialize`.
- `src/languages/go/noise.ts` — `fmt`, `Println`, `Printf`, `Sprintf`, `Errorf`, `make`, `panic`, `recover`, `defer`, `len`, `cap`, `append`, `copy`, `new`, `close`, `delete`.
- `src/languages/java/noise.ts` — `System`, `println`, `equals`, `hashCode`, `getClass`, `toString`.
- `src/languages/kotlin/noise.ts` — `println`, `print`, `listOf`, `mapOf`, `setOf`, `let`, `apply`, `run`, `also`, `with`, `require`.
- `src/languages/csharp/noise.ts` — `Console`, `WriteLine`, `Write`, `ToString`, `Equals`, `GetHashCode`, `GetType`.
- `src/languages/rust/noise.ts` — `println`, `print`, `eprintln`, `eprint`, `format`, `write`, `panic`, `vec`, `assert`, `assert_eq`, `assert_ne`, `unwrap`, `expect`, `clone`, `to_string`, `to_owned`, `into`, `from`.
- `src/languages/php/noise.ts` — `echo`, `print`, `var_dump`, `print_r`, `isset`, `empty`, `count`, `array_map`, `array_filter`, `array_reduce`, `array_merge`, `implode`, `explode`.
- `src/languages/swift/noise.ts` — `print`, `debugPrint`, `dump`, `String`, `Int`, `Double`, `Array`, `Dictionary`, `Optional`.
- `src/languages/dart/noise.ts` — `print`, `toString`, `hashCode`, `runtimeType`, `noSuchMethod`.
- `src/languages/scala/noise.ts` — `println`, `print`, `Some`, `None`, `Option`, `Seq`, `List`, `Map`, `Set`, `toString`.
- `src/languages/c/noise.ts` — `printf`, `fprintf`, `sprintf`, `scanf`, `malloc`, `free`, `memcpy`, `memset`, `strlen`, `strcpy`, `strcmp`, `sizeof`. (Shared by `'Cpp'` too — register under both keys.)
- `src/languages/elixir/noise.ts` — `IO`, `puts`, `inspect`, `Enum`, `map`, `filter`, `reduce`, `each`, `to_string`, `String`, `Map`, `List`.

> **Keep discipline:** when deciding whether a name belongs in a language's noise list, ask "is this 99% of the time a stdlib/framework call in THIS language?". If it could plausibly be a user method in that language, leave it out. Task 7 lets the statistical signal catch codebase-specific ambiguity.

- [ ] **Step 6.5: Wire each language's `index.ts` to import its `./noise` for side-effect**

For each `src/languages/<lang>/index.ts`, add:

```typescript
import './noise';
```

Place it alongside the existing `import './extractor';` line.

- [ ] **Step 6.6: Run the test and confirm it passes**

Run: `bun test tests/languages/noise.test.ts`
Expected: 4 passing.

- [ ] **Step 6.7: Run full check**

Run: `bun run check`
Expected: green. Existing call-resolver tests still pass because they use the old global `NOISE` — Task 7 swaps the lookup.

- [ ] **Step 6.8: Commit**

```bash
git add src/languages/noise-registry.ts src/languages/*/noise.ts src/languages/*/index.ts tests/languages/noise.test.ts
git commit -m "feat(noise): introduce per-language noise registry"
```

---

## Task 7: Route NOISE by language in call resolver; remove global NOISE

**Files:**
- Create: `src/languages/language-of-file.ts`
- Create: `tests/languages/language-of-file.test.ts`
- Modify: `src/resolver/call-resolver.ts`
- Modify: `src/shared/filters.ts` (remove the cross-language `NOISE` set)
- Modify: `tests/resolver/call-resolver*` (update any test that relied on cross-language noise)

- [ ] **Step 7.1: Write the failing test for `languageOfFile`**

Create `tests/languages/language-of-file.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { languageOfFile } from '../../src/languages/language-of-file';

describe('languageOfFile', () => {
    it('maps .ts to TypeScript', () => {
        expect(languageOfFile('src/auth.ts')).toBe('TypeScript');
    });
    it('maps .tsx to Tsx', () => {
        expect(languageOfFile('src/Foo.tsx')).toBe('Tsx');
    });
    it('maps .py to Python', () => {
        expect(languageOfFile('lib/main.py')).toBe('Python');
    });
    it('maps .rb to Ruby', () => {
        expect(languageOfFile('app/user.rb')).toBe('Ruby');
    });
    it('maps .go to Go', () => {
        expect(languageOfFile('cmd/main.go')).toBe('Go');
    });
    it('returns null for unknown extensions', () => {
        expect(languageOfFile('README.md')).toBeNull();
        expect(languageOfFile('config')).toBeNull();
    });
});
```

- [ ] **Step 7.2: Create `src/languages/language-of-file.ts`**

```typescript
/**
 * Pure lookup: file path -> language key used by extractors and noise registry.
 *
 * Mirrors the extension → language mapping registered in
 * `src/parser/languages.ts`. Kept as a pure function so the resolver can call
 * it without depending on the parser lifecycle.
 */

const EXT_TO_LANG: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'Tsx',
    js: 'JavaScript',
    jsx: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    py: 'Python',
    rb: 'Ruby',
    go: 'Go',
    java: 'Java',
    kt: 'Kotlin',
    kts: 'Kotlin',
    rs: 'Rust',
    cs: 'CSharp',
    php: 'Php',
    swift: 'Swift',
    dart: 'Dart',
    scala: 'Scala',
    c: 'C',
    h: 'C',
    cc: 'Cpp',
    cpp: 'Cpp',
    cxx: 'Cpp',
    hpp: 'Cpp',
    ex: 'Elixir',
    exs: 'Elixir',
};

export function languageOfFile(filePath: string): string | null {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) {
        return null;
    }
    const ext = filePath.substring(dot + 1).toLowerCase();
    return EXT_TO_LANG[ext] ?? null;
}
```

> **Verify** this table matches `src/parser/languages.ts` before writing. If the parser supports additional extensions (e.g. `.mts`, `.cts`), add them here.

- [ ] **Step 7.3: Run the test and confirm it passes**

Run: `bun test tests/languages/language-of-file.test.ts`
Expected: 6 passing.

- [ ] **Step 7.4: Write the failing test for resolver using per-language noise**

In `tests/resolver/call-resolver-noise.test.ts` (new or appended):

```typescript
import { describe, expect, it } from 'bun:test';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { SymbolTable } from '../../src/resolver/symbol-table';
import { ImportMap } from '../../src/resolver/import-map';
import '../../src/languages/typescript';
import '../../src/languages/ruby';

describe('NOISE is routed by language', () => {
    it('drops `log` in a .ts file (TS noise)', () => {
        const { stats } = resolveAllCalls(
            [{ source: 'a.ts', callName: 'log', line: 1 }],
            new Map(),
            new SymbolTable(),
            new ImportMap(),
        );
        expect(stats.noise).toBe(1);
    });

    it('does NOT drop `update` in a .rb file at the noise tier (only TS treated update as noise historically)', () => {
        // `update` is user-domain in Ruby. With global NOISE removed, it should
        // not be dropped at the noise tier. It may still be ambiguous-dropped,
        // but stats.noise for this single call must be 0.
        const { stats } = resolveAllCalls(
            [{ source: 'a.rb', callName: 'update', line: 1 }],
            new Map(),
            new SymbolTable(),
            new ImportMap(),
        );
        expect(stats.noise).toBe(0);
    });

    it('drops `puts` in a .rb file (Ruby noise)', () => {
        const { stats } = resolveAllCalls(
            [{ source: 'a.rb', callName: 'puts', line: 1 }],
            new Map(),
            new SymbolTable(),
            new ImportMap(),
        );
        expect(stats.noise).toBe(1);
    });
});
```

- [ ] **Step 7.5: Run the test — expect failures where cross-language noise masks expected behavior**

Run: `bun test tests/resolver/call-resolver-noise.test.ts`
Expected: at least one failure (either `update` was being noise-dropped, or Ruby `puts` was not in the pre-existing global list — verify).

- [ ] **Step 7.6: Replace global `NOISE` check in `call-resolver.ts`**

At the top:

```typescript
import { getNoiseFor } from '../languages/noise-registry';
import { languageOfFile } from '../languages/language-of-file';
```

Replace the `if (NOISE.has(call.callName))` check at `call-resolver.ts:65`:

```typescript
const lang = languageOfFile(call.source);
const noise = lang ? getNoiseFor(lang) : null;
if (noise && noise.has(call.callName)) {
    stats.noise++;
    continue;
}
```

Remove the top-level `import { NOISE, AMBIGUOUS_NOISE } from '../shared/filters';` — Task 8 handles `AMBIGUOUS_NOISE`. For this task, change the import to only pull what's still needed (or leave `AMBIGUOUS_NOISE` in place temporarily; Task 8 removes it).

The ambiguous-noise drop at the ambiguous tier (lines 229-234) still uses the old `AMBIGUOUS_NOISE` — leave it; Task 8 replaces it with the statistical signal.

Also remove the `NOISE.has(callName)` guard in the public `resolveCall` wrapper (lines 309-311):

```typescript
export function resolveCall(
    callName: string,
    currentFile: string,
    symbolTable: SymbolTable,
    importMap: ImportMap,
): { target: string; confidence: number } | null {
    const lang = languageOfFile(currentFile);
    const noise = lang ? getNoiseFor(lang) : null;
    if (noise && noise.has(callName)) {
        return null;
    }
    const result = resolveByName(callName, currentFile, symbolTable, importMap);
    if (!result || result === AMBIGUOUS_NOISE_DROP) {
        return null;
    }
    return { target: result.target, confidence: result.confidence };
}
```

- [ ] **Step 7.7: Run resolver + noise tests**

Run: `bun test tests/resolver/ tests/languages/noise.test.ts`
Expected: green.

- [ ] **Step 7.8: Delete the cross-language `NOISE` from `src/shared/filters.ts`**

Remove the `export const NOISE = new Set([...])` block entirely (filters.ts:39-243). Leave `SKIP_DIRS`, `SKIP_FILE_PATTERNS`, `isSkippableFile`, and `AMBIGUOUS_NOISE` (Task 8 handles the last).

- [ ] **Step 7.9: Fix any test that imported the old global `NOISE`**

Search: `grep -rn "from.*shared/filters" tests/ src/ | grep -v "SKIP\|isSkippable\|AMBIGUOUS"` — any hit that expected the global `NOISE` export now fails. Update those to import via the registry or inline the specific set they needed.

- [ ] **Step 7.10: Run full check**

Run: `bun run check`
Expected: green.

- [ ] **Step 7.11: Commit**

```bash
git add src/languages/language-of-file.ts src/resolver/call-resolver.ts src/shared/filters.ts tests/resolver/ tests/languages/language-of-file.test.ts
git commit -m "refactor(noise): route noise by language, remove global NOISE set"
```

---

## Task 8: Statistical ambiguous-noise detection; remove AMBIGUOUS_NOISE

**Files:**
- Modify: `src/resolver/symbol-table.ts` — add `countDefinitions(name)`.
- Modify: `src/resolver/call-resolver.ts` — use threshold instead of static set.
- Modify: `src/shared/filters.ts` — remove `AMBIGUOUS_NOISE` export.
- Create: `tests/resolver/statistical-ambiguous.test.ts`.
- Modify: `AGENTS.md` — add the hardcode principle.

- [ ] **Step 8.1: Write the failing test**

Create `tests/resolver/statistical-ambiguous.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { SymbolTable } from '../../src/resolver/symbol-table';
import { ImportMap } from '../../src/resolver/import-map';

function makeTable(defs: { qualified: string }[]): SymbolTable {
    const t = new SymbolTable();
    for (const d of defs) {
        // Use the actual registration API exposed by SymbolTable.
        t.register(d.qualified);
    }
    return t;
}

describe('statistical ambiguous-noise', () => {
    it('drops calls whose target name is defined in >15 files', () => {
        const defs = Array.from({ length: 20 }, (_, i) => ({ qualified: `src/m${i}.ts::validate` }));
        const table = makeTable(defs);
        const { stats } = resolveAllCalls(
            [{ source: 'src/caller.ts', callName: 'validate', line: 1 }],
            new Map(),
            table,
            new ImportMap(),
        );
        expect(stats.ambiguousNoise).toBe(1);
    });

    it('does NOT drop when definition count is below threshold', () => {
        const defs = [{ qualified: 'src/m1.ts::validate' }, { qualified: 'src/m2.ts::validate' }];
        const table = makeTable(defs);
        const { stats, callEdges } = resolveAllCalls(
            [{ source: 'src/caller.ts', callName: 'validate', line: 1 }],
            new Map(),
            table,
            new ImportMap(),
        );
        expect(stats.ambiguousNoise).toBe(0);
        expect(callEdges.length).toBe(1);
        expect(callEdges[0].confidence).toBe(0.3);
    });
});
```

> If `SymbolTable` does not yet expose a `register` method with this exact shape, the test can use whatever existing public API it has (`addDefinition`, `recordSymbol`, etc.). Adjust the helper accordingly.

- [ ] **Step 8.2: Run and confirm it fails**

Run: `bun test tests/resolver/statistical-ambiguous.test.ts`
Expected: fail (the global `AMBIGUOUS_NOISE` still includes `validate`, so the second test expects `ambiguousNoise: 0` but gets `1`; the first test may pass "for the wrong reason").

- [ ] **Step 8.3: Add `countDefinitions` to `SymbolTable`**

Find the global-index field in `src/resolver/symbol-table.ts` (a `Map<name, qualified[]>` or similar). Add:

```typescript
/**
 * Number of distinct files that declare a symbol with this name.
 * Used by the resolver to decide if a name is "codebase-ambiguous" without
 * relying on a hardcoded blacklist.
 */
countDefinitions(name: string): number {
    const candidates = this.lookupGlobal(name);
    if (candidates.length === 0) {
        return 0;
    }
    const files = new Set<string>();
    for (const q of candidates) {
        const file = q.includes('::') ? q.split('::')[0] : q;
        files.add(file);
    }
    return files.size;
}
```

- [ ] **Step 8.4: Replace `AMBIGUOUS_NOISE` check with statistical signal in `call-resolver.ts`**

At the ambiguous tier (inside `resolveByName`, lines 229-234 approximately):

```typescript
// Strategy 4: Ambiguous (0.30) — pick closest candidate, drop if codebase-ambiguous
const candidates = symbolTable.lookupGlobal(callName);
if (candidates.length > 1) {
    // Codebase-ambiguous: many files define this name -> proximity picks are noise.
    // Threshold derived from repo size so small repos with natural duplication
    // aren't over-filtered.
    const definingFiles = symbolTable.countDefinitions(callName);
    if (isCodebaseAmbiguous(definingFiles, symbolTable)) {
        return AMBIGUOUS_NOISE_DROP;
    }
    const best = pickClosestCandidate(candidates, currentFile);
    return { target: best, confidence: 0.3, strategy: 'ambiguous' };
}
```

Add the predicate at the top of the file:

```typescript
/**
 * A name is codebase-ambiguous when it is defined in so many files that
 * proximity-based disambiguation becomes unreliable.
 *
 * Thresholds are expressed as both an absolute floor (for small repos) and a
 * fraction of total indexed files (for large repos), whichever is bigger.
 */
function isCodebaseAmbiguous(definingFileCount: number, symbolTable: SymbolTable): boolean {
    const totalFiles = symbolTable.totalIndexedFiles();
    const floor = 15;
    const fractional = Math.ceil(totalFiles * 0.02);
    const threshold = Math.max(floor, fractional);
    return definingFileCount >= threshold;
}
```

Add `totalIndexedFiles()` to `SymbolTable` (return the size of whatever file-index it maintains; if it doesn't maintain one, derive from unique files in the global index):

```typescript
totalIndexedFiles(): number {
    const files = new Set<string>();
    for (const quals of this.globalIndex.values()) {
        for (const q of quals) {
            const file = q.includes('::') ? q.split('::')[0] : q;
            files.add(file);
        }
    }
    return files.size;
}
```

> If the symbol table already tracks a `byFile` map, use its `.size` directly. The two implementations must agree.

- [ ] **Step 8.5: Remove all references to the static `AMBIGUOUS_NOISE`**

Drop the import in `call-resolver.ts`. Delete the `AMBIGUOUS_NOISE` export from `src/shared/filters.ts`. After this, `src/shared/filters.ts` contains only `SKIP_DIRS`, `SKIP_FILE_PATTERNS`, `isSkippableFile`.

- [ ] **Step 8.6: Run the tests**

Run: `bun test tests/resolver/statistical-ambiguous.test.ts`
Expected: 2 passing.

- [ ] **Step 8.7: Run full test suite**

Run: `bun run check`
Expected: green. Any broken tests probably relied on the old `AMBIGUOUS_NOISE` behavior — update them to seed the symbol table with enough fake definitions to trigger the statistical drop, or adjust assertions to reflect that `update`/`validate`/`process` now resolve to ambiguous edges (0.30) when defined in few files.

- [ ] **Step 8.8: Add the hardcode principle to `AGENTS.md`**

In `AGENTS.md`, under the `### Architecture Patterns` section, append:

```markdown
- **No cross-language hardcoded heuristics.** Any string list that depends on a specific language (builtins, noise names, branching AST kinds) lives in `src/languages/<lang>/`, not in `src/shared/`. Any heuristic that depends on the shape of the current codebase (e.g. "this name is too common to disambiguate") is computed from the symbol table at resolve time, not blacklisted statically. `src/shared/` is reserved for utilities that are genuinely language- and repo-agnostic (filesystem filters, hashing, logging, schemas).
```

- [ ] **Step 8.9: Commit**

```bash
git add src/resolver/symbol-table.ts src/resolver/call-resolver.ts src/shared/filters.ts tests/resolver/statistical-ambiguous.test.ts AGENTS.md
git commit -m "feat(resolver): replace AMBIGUOUS_NOISE with statistical threshold"
```

---

## Post-Phase Verification

- [ ] **Run the full suite one last time**

Run: `bun run check`
Expected: green across typecheck, lint, and tests.

- [ ] **Sanity check against a real repo**

Run kodus-graph against an existing repo you already have a known-good graph for. Diff the outputs:

```bash
bun run dev parse --all --repo-dir ~/some-project --out /tmp/new-graph.json
# Compare /tmp/new-graph.json against the pre-Phase-1 output.
```

Expected differences (and nothing else):
- `metadata.schema_version` is present.
- Every function node has `complexity`.
- Ruby/Python/Go/etc. codebases show edges for user methods that were previously dropped (e.g. `update()` in Ruby).
- Risk scores using the new cyclomatic complexity signal may shift slightly on previously-lines-dominated cases — inspect a few to confirm the new values are defensible.

- [ ] **Update the README risk-score example table if the weights text mentions 40%**

If `README.md` still has lingering 40% references from the old risk formula, sweep them out.

---

## Follow-up plans (not in this phase)

- **Phase 2:** per-language DI heuristics, `alternatives[]` on ambiguous CALLS edges, indexed risk-score (drop linear scans), move `I→Impl` heuristic out of `call-resolver.ts`.
- **Phase 3:** `LanguageCapabilities` registry, receiver-type-aware call resolution, tier distribution stats surfaced in `metadata` to expose the "honesty gap" for dynamic languages.
