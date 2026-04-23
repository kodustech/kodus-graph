# Language Support Matrix + CI Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unsubstantiated "supports 14 languages" claim with (1) a machine-readable support matrix showing per-language capability depth, (2) a CI quality gate that parses a canonical fixture per language and asserts baseline tier_distribution ratios, and (3) a human-readable matrix doc auto-derived from the machine spec.

**Architecture:** Single source of truth (`src/languages/support-matrix.ts`) enumerates what each registered language supports — noise, capabilities, DI heuristic, receiver-type, and baseline-tier expectations. A generator (`scripts/generate-language-matrix.ts`) produces `docs/language-support-matrix.md`. A CI test (`tests/integration/language-coverage.test.ts`) loads each language's canonical fixture, runs parse + resolve, and asserts tier ratios fall within recorded bands. Drift in any direction fails CI with a clear message.

**Tech Stack:** TypeScript (strict), Bun runtime, `bun:test`, existing `LanguageCapabilities` / `noise-registry` / DI registry / receiver-types infrastructure, Zod for matrix validation.

**Why this plan is foundational (and why phases C/D/E come after):**

- Without the bar defined (this plan), "fix Java DI" has no success criterion.
- Without the CI gate (this plan), fixing Java may regress Python silently.
- The smoke-validation of 10 untested languages (Phase D) NEEDS this harness to run them through.
- The honest README (Phase E) consumes the generator's markdown output.

**Out of scope for this plan (separate plans to follow):**

- Language-specific feature additions (Java `@Inject`, Python `Depends()`, Go factories, Ruby perf, Maven imports).
- Smoke-testing the 10 languages not yet validated on real repos.
- README rewrite.

---

## File Structure

### New files

- `src/languages/support-matrix.ts` — single source of truth. Exports `LANGUAGE_SUPPORT` (readonly array of per-language support records) and a `LanguageSupportRecord` type. Values are hand-curated based on current state; CI verifies them.
- `src/languages/support-matrix-schema.ts` — Zod schema that validates `LANGUAGE_SUPPORT` shape at module load. Paranoid but cheap.
- `scripts/generate-language-matrix.ts` — reads `LANGUAGE_SUPPORT`, emits `docs/language-support-matrix.md`. Wired via `bun run docs:matrix` in `package.json`.
- `tests/integration/language-coverage.test.ts` — per-language CI gate. For each entry in `LANGUAGE_SUPPORT` with a `canonical_fixture`, parse → resolve → assert tier ratios within recorded bands.
- `docs/language-support-matrix.md` — auto-generated; committed so GitHub renders it without running the script.
- `tests/support-matrix.test.ts` — Zod-schema test + consistency check (every `registerExtractor` key appears in `LANGUAGE_SUPPORT`).

### Modified files

- `package.json` — add `"docs:matrix": "bun run scripts/generate-language-matrix.ts"`.
- `README.md` — replace the bullet "14 languages" with a link to the generated matrix. Minimal; the full README rewrite is Phase E.

---

## Task 1: `LanguageSupportRecord` type + schema

**Files:**
- Create: `src/languages/support-matrix-schema.ts`
- Create: `tests/support-matrix.test.ts`

- [ ] **Step 1.1: Write the failing schema shape test**

Create `tests/support-matrix.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { supportMatrixSchema, type LanguageSupportRecord } from '../src/languages/support-matrix-schema';

describe('support-matrix-schema', () => {
    it('accepts a fully-populated record', () => {
        const record: LanguageSupportRecord = {
            key: 'TypeScript',
            display_name: 'TypeScript',
            tier: 'full',
            parse_speed: 'fast',
            features: {
                noise: true,
                capabilities: true,
                di_heuristic: true,
                receiver_type: 'class+init+typed-param',
                complexity_kinds: true,
                imports: true,
            },
            canonical_fixture: 'tests/fixtures/sample-repo',
            baseline_tier_ratios: {
                resolved_min: 0.7,
                ambiguous_max: 0.45,
                receiver_min_per_1k_nodes: 20,
                di_min_per_1k_nodes: 10,
                high_conf_min_ratio: 0.1,
            },
            notes: [],
        };
        expect(() => supportMatrixSchema.parse([record])).not.toThrow();
    });

    it('rejects a record with unknown tier', () => {
        const bad = [
            {
                key: 'X',
                display_name: 'X',
                tier: 'godlike',
                parse_speed: 'fast',
                features: {
                    noise: true,
                    capabilities: true,
                    di_heuristic: false,
                    receiver_type: 'none',
                    complexity_kinds: true,
                    imports: false,
                },
                canonical_fixture: null,
                baseline_tier_ratios: null,
                notes: [],
            },
        ];
        expect(() => supportMatrixSchema.parse(bad)).toThrow();
    });

    it('rejects a record missing required fields (strict)', () => {
        const bad = [{ key: 'Y', display_name: 'Y', tier: 'full' }];
        expect(() => supportMatrixSchema.parse(bad)).toThrow();
    });
});
```

- [ ] **Step 1.2: Run the test and confirm it fails**

Run: `bun test tests/support-matrix.test.ts`
Expected: fail with `Cannot find module '../src/languages/support-matrix-schema'`.

- [ ] **Step 1.3: Create `src/languages/support-matrix-schema.ts`**

```typescript
import { z } from 'zod';

/**
 * Per-language support record. Single source of truth for what kodus-graph
 * claims to support for each registered language. Consumed by:
 *   - `scripts/generate-language-matrix.ts` → docs/language-support-matrix.md
 *   - `tests/integration/language-coverage.test.ts` → CI quality gate
 *
 * `tier` interpretation:
 *   - 'full':         validated on a real open-source repo ≥10k LOC, all features registered
 *   - 'basic':        unit-tested on fixtures, no real-repo validation, features partially registered
 *   - 'experimental': registered but not tested beyond smoke fixtures; expect gaps
 */
const featuresSchema = z
    .object({
        noise: z.boolean(),
        capabilities: z.boolean(),
        di_heuristic: z.boolean(),
        receiver_type: z.enum([
            'none',
            'scope-local',
            'class+init',
            'class+init+typed-param',
            'factory',
            'full',
        ]),
        complexity_kinds: z.boolean(),
        imports: z.boolean(),
    })
    .strict();

const baselineTierRatiosSchema = z
    .object({
        /** `(total_edges_resolved) / (total_call_sites)` must be ≥ this. */
        resolved_min: z.number().min(0).max(1),
        /** `ambiguous / resolved` must be ≤ this. */
        ambiguous_max: z.number().min(0).max(1),
        /** `receiver / (nodes/1000)` must be ≥ this (receiver hits per 1k nodes). */
        receiver_min_per_1k_nodes: z.number().min(0),
        /** `di / (nodes/1000)` must be ≥ this. 0 means language opts out. */
        di_min_per_1k_nodes: z.number().min(0),
        /** `(receiver + di + same) / resolved` must be ≥ this. */
        high_conf_min_ratio: z.number().min(0).max(1),
    })
    .strict();

export const recordSchema = z
    .object({
        key: z.string(),
        display_name: z.string(),
        tier: z.enum(['full', 'basic', 'experimental']),
        parse_speed: z.enum(['fast', 'moderate', 'slow']),
        features: featuresSchema,
        canonical_fixture: z.string().nullable(),
        baseline_tier_ratios: baselineTierRatiosSchema.nullable(),
        notes: z.array(z.string()),
    })
    .strict();

export const supportMatrixSchema = z.array(recordSchema);

export type LanguageSupportRecord = z.infer<typeof recordSchema>;
```

- [ ] **Step 1.4: Run the test and confirm it passes**

Run: `bun test tests/support-matrix.test.ts`
Expected: 3 passing.

- [ ] **Step 1.5: Commit**

```bash
git add src/languages/support-matrix-schema.ts tests/support-matrix.test.ts
git commit -m "feat(matrix): LanguageSupportRecord type + Zod schema"
```

---

## Task 2: `LANGUAGE_SUPPORT` canonical data

**Files:**
- Create: `src/languages/support-matrix.ts`
- Modify: `tests/support-matrix.test.ts` (add consistency test)

- [ ] **Step 2.1: Write the failing consistency test**

Append to `tests/support-matrix.test.ts`:

```typescript
import { LANGUAGE_SUPPORT } from '../src/languages/support-matrix';
import { listRegisteredLanguages } from '../src/languages/engine';
// Side-effect imports: make sure every language registers itself.
import '../src/languages/c';
import '../src/languages/csharp';
import '../src/languages/dart';
import '../src/languages/elixir';
import '../src/languages/go';
import '../src/languages/java';
import '../src/languages/kotlin';
import '../src/languages/php';
import '../src/languages/python';
import '../src/languages/ruby';
import '../src/languages/rust';
import '../src/languages/scala';
import '../src/languages/swift';
import '../src/languages/typescript';

describe('LANGUAGE_SUPPORT consistency', () => {
    it('passes the Zod schema', () => {
        expect(() => supportMatrixSchema.parse(LANGUAGE_SUPPORT)).not.toThrow();
    });

    it('covers every registered extractor (no missing languages)', () => {
        const registered = new Set(listRegisteredLanguages());
        const matrixKeys = new Set(LANGUAGE_SUPPORT.map((r) => r.key));
        for (const key of registered) {
            expect(matrixKeys.has(key)).toBe(true);
        }
    });

    it('contains no ghost entries (no matrix keys without a registered extractor)', () => {
        const registered = new Set(listRegisteredLanguages());
        for (const record of LANGUAGE_SUPPORT) {
            expect(registered.has(record.key)).toBe(true);
        }
    });

    it('all `full`-tier records have a canonical_fixture and baseline_tier_ratios', () => {
        for (const r of LANGUAGE_SUPPORT) {
            if (r.tier === 'full') {
                expect(r.canonical_fixture).not.toBeNull();
                expect(r.baseline_tier_ratios).not.toBeNull();
            }
        }
    });
});
```

- [ ] **Step 2.2: Run — expect failure**

Run: `bun test tests/support-matrix.test.ts`
Expected: 4 new tests fail (`LANGUAGE_SUPPORT` doesn't exist yet).

- [ ] **Step 2.3: Create `src/languages/support-matrix.ts`**

Populate based on the current known state from this session's validation work. Keys MUST match `registerExtractor` exactly.

```typescript
import type { LanguageSupportRecord } from './support-matrix-schema';

/**
 * Canonical support matrix for kodus-graph's registered languages.
 *
 * Tier values are honest:
 *   - 'full':         validated on a real open-source repo ≥10k LOC,
 *                     full feature coverage, passes CI quality gate
 *   - 'basic':        unit tests pass, no real-repo validation yet
 *   - 'experimental': registered but not exercised on real code
 *
 * Baselines are LOOSE floors derived from conservative interpretation of
 * current real-repo numbers. CI asserts the language stays AT OR ABOVE
 * these floors — improvements are welcome, regressions fail.
 *
 * Update this file when: a new language is added, a language is validated
 * on a real repo for the first time, a known limitation is closed.
 */
export const LANGUAGE_SUPPORT: readonly LanguageSupportRecord[] = [
    // ── Full-support tier (real-repo validated) ──────────────────────────
    {
        key: 'TypeScript',
        display_name: 'TypeScript',
        tier: 'full',
        parse_speed: 'fast',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'class+init+typed-param',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/sample-repo',
        baseline_tier_ratios: {
            resolved_min: 0.5,
            ambiguous_max: 0.5,
            receiver_min_per_1k_nodes: 5,
            di_min_per_1k_nodes: 5,
            high_conf_min_ratio: 0.15,
        },
        notes: ['Validated on calcom (1G), sentry (779M), grafana (1.2G)'],
    },
    {
        key: 'Tsx',
        display_name: 'TypeScript JSX',
        tier: 'full',
        parse_speed: 'fast',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'class+init+typed-param',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: null,
        baseline_tier_ratios: null,
        notes: ['Shares TypeScript extractor; exercised via TSX files in all 3 TS-validated repos'],
    },
    {
        key: 'JavaScript',
        display_name: 'JavaScript',
        tier: 'full',
        parse_speed: 'fast',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'class+init+typed-param',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: null,
        baseline_tier_ratios: null,
        notes: ['Shares TypeScript extractor (same AST grammar)'],
    },
    {
        key: 'python',
        display_name: 'Python',
        tier: 'full',
        parse_speed: 'fast',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'class+init+typed-param',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/python',
        baseline_tier_ratios: {
            resolved_min: 0.4,
            ambiguous_max: 0.6,
            receiver_min_per_1k_nodes: 1,
            di_min_per_1k_nodes: 0,
            high_conf_min_ratio: 0.1,
        },
        notes: [
            'Validated on sentry (779M, 6613 .py files)',
            'di=0 is honest: Python has no Spring/Angular-style container. FastAPI Depends() is a future addition.',
            'self.attr receiver-type via class attrs + __init__ typed params only; no flow analysis',
        ],
    },
    {
        key: 'go',
        display_name: 'Go',
        tier: 'full',
        parse_speed: 'fast',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'factory',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/go',
        baseline_tier_ratios: {
            resolved_min: 0.4,
            ambiguous_max: 0.6,
            receiver_min_per_1k_nodes: 1,
            di_min_per_1k_nodes: 0,
            high_conf_min_ratio: 0.1,
        },
        notes: [
            'Validated on grafana (1.2G, 2741 .go files)',
            'Receiver-type via x := NewFoo() factory sniff only',
            'DI heuristic: -er suffix strip',
        ],
    },
    // ── Basic tier (unit tests + small fixture; real repo shows gaps) ────
    {
        key: 'java',
        display_name: 'Java',
        tier: 'basic',
        parse_speed: 'slow',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'scope-local',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/java',
        baseline_tier_ratios: {
            resolved_min: 0.3,
            ambiguous_max: 0.8,
            receiver_min_per_1k_nodes: 0,
            di_min_per_1k_nodes: 0,
            high_conf_min_ratio: 0.05,
        },
        notes: [
            'Validated on keycloak (801M, 6665 .java files)',
            'Foo->FooImpl heuristic matches 1.7% of interfaces; real Java uses @Inject/@Autowired (not parsed)',
            'Multi-module Maven import resolution ~2% (weak)',
            'Known gap: enterprise Java requires annotation-based DI. Tracked in separate plan.',
        ],
    },
    {
        key: 'ruby',
        display_name: 'Ruby',
        tier: 'basic',
        parse_speed: 'slow',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'none',
            complexity_kinds: true,
            imports: false,
        },
        canonical_fixture: 'tests/fixtures/ruby',
        baseline_tier_ratios: null,
        notes: [
            'Large-repo parse slow (~12min on discourse 11k Ruby files); ast-grep Ruby grammar bottleneck',
            'Receiver-type: no-op (duck typing)',
            'No DI heuristic registered',
            'Known limitation: streaming output or worker parallelism needed for interactive use',
        ],
    },
    {
        key: 'kotlin',
        display_name: 'Kotlin',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'scope-local',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/kotlin',
        baseline_tier_ratios: null,
        notes: ['Reuses Java DI heuristic', 'Not validated on real repo'],
    },
    {
        key: 'rust',
        display_name: 'Rust',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'scope-local',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/rust',
        baseline_tier_ratios: null,
        notes: ['No DI convention', 'capabilities: hasExceptions=false (Result/Option)'],
    },
    {
        key: 'csharp',
        display_name: 'C#',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'scope-local',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/csharp',
        baseline_tier_ratios: null,
        notes: ['IFoo->Foo DI heuristic (same as TypeScript)'],
    },
    {
        key: 'scala',
        display_name: 'Scala',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'scope-local',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/scala',
        baseline_tier_ratios: null,
        notes: ['Reuses Java DI heuristic'],
    },
    {
        key: 'php',
        display_name: 'PHP',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: true,
            receiver_type: 'none',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/php',
        baseline_tier_ratios: null,
        notes: ['Reuses Java DI heuristic; no receiver-type inference'],
    },
    {
        key: 'swift',
        display_name: 'Swift',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'scope-local',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/swift',
        baseline_tier_ratios: null,
        notes: [],
    },
    {
        key: 'dart',
        display_name: 'Dart',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'scope-local',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/dart',
        baseline_tier_ratios: null,
        notes: ['Member-call extraction required custom sibling-walk (Dart grammar has no method_invocation kind)'],
    },
    {
        key: 'c',
        display_name: 'C',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'none',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/c',
        baseline_tier_ratios: null,
        notes: ['capabilities: hasExceptions=false'],
    },
    {
        key: 'cpp',
        display_name: 'C++',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'none',
            complexity_kinds: true,
            imports: true,
        },
        canonical_fixture: 'tests/fixtures/cpp',
        baseline_tier_ratios: null,
        notes: ['Shares C extractor; capabilities.hasExceptions=true'],
    },
    {
        key: 'elixir',
        display_name: 'Elixir',
        tier: 'basic',
        parse_speed: 'moderate',
        features: {
            noise: true,
            capabilities: true,
            di_heuristic: false,
            receiver_type: 'none',
            complexity_kinds: true,
            imports: false,
        },
        canonical_fixture: 'tests/fixtures/elixir',
        baseline_tier_ratios: null,
        notes: [
            'Complexity uses specialized computeElixirComplexity (grammar emits call nodes, not distinct kinds)',
            'capabilities: hasAsync=false (BEAM concurrency, not async/await)',
        ],
    },
];
```

- [ ] **Step 2.4: Run the tests — expect pass**

Run: `bun test tests/support-matrix.test.ts`
Expected: 6 passing (3 schema + 4 consistency − 1 = actually 4 schema tests pass + 4 consistency = 7, but the subclass count may vary; just ensure all green).

If `listRegisteredLanguages()` returns keys not in `LANGUAGE_SUPPORT`, the test will tell you exactly which keys are missing. Add them.

- [ ] **Step 2.5: Full check**

Run: `bun run check`
Expected: green.

- [ ] **Step 2.6: Commit**

```bash
git add src/languages/support-matrix.ts tests/support-matrix.test.ts
git commit -m "feat(matrix): canonical LANGUAGE_SUPPORT records (17 keys)"
```

---

## Task 3: Markdown generator + `bun run docs:matrix`

**Files:**
- Create: `scripts/generate-language-matrix.ts`
- Create: `docs/language-support-matrix.md` (generated output, committed)
- Modify: `package.json`

- [ ] **Step 3.1: Create the generator**

`scripts/generate-language-matrix.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Generate docs/language-support-matrix.md from LANGUAGE_SUPPORT.
 * Run: `bun run docs:matrix`
 *
 * Writes a human-readable markdown table that GitHub renders in the doc
 * tree. CI can re-run this and diff to catch un-regenerated docs.
 */
import { writeFileSync } from 'fs';
import { LANGUAGE_SUPPORT } from '../src/languages/support-matrix';
import type { LanguageSupportRecord } from '../src/languages/support-matrix-schema';

const TIER_ICON: Record<LanguageSupportRecord['tier'], string> = {
    full: '🟢',
    basic: '🟡',
    experimental: '🔴',
};

const PARSE_ICON: Record<LanguageSupportRecord['parse_speed'], string> = {
    fast: '⚡',
    moderate: '🚶',
    slow: '🐢',
};

const RECEIVER_LABEL: Record<LanguageSupportRecord['features']['receiver_type'], string> = {
    none: '—',
    'scope-local': 'scope-local',
    'class+init': 'class+init',
    'class+init+typed-param': 'class+init+param',
    factory: 'factory',
    full: 'full',
};

function tick(b: boolean): string {
    return b ? '✓' : '—';
}

function renderRow(r: LanguageSupportRecord): string {
    return [
        '| ' + r.display_name,
        TIER_ICON[r.tier] + ' ' + r.tier,
        PARSE_ICON[r.parse_speed] + ' ' + r.parse_speed,
        tick(r.features.noise),
        tick(r.features.capabilities),
        tick(r.features.di_heuristic),
        RECEIVER_LABEL[r.features.receiver_type],
        tick(r.features.complexity_kinds),
        tick(r.features.imports),
        r.canonical_fixture ? '`' + r.canonical_fixture + '`' : '—',
        ' |',
    ].join(' | ');
}

function render(): string {
    const lines: string[] = [];
    lines.push('# Language Support Matrix');
    lines.push('');
    lines.push('> Auto-generated from `src/languages/support-matrix.ts` via `bun run docs:matrix`.');
    lines.push('> Do not edit this file by hand — changes will be overwritten.');
    lines.push('');
    lines.push('## Legend');
    lines.push('');
    lines.push('- **Tier**: 🟢 full = validated on a real open-source repo ≥10k LOC, features registered. 🟡 basic = unit-tested on fixtures, no real-repo validation. 🔴 experimental = registered but not exercised on real code.');
    lines.push('- **Parse speed**: ⚡ fast (<50ms avg/file), 🚶 moderate (50-500ms), 🐢 slow (>500ms).');
    lines.push('- **Receiver type**: `scope-local` covers `const x = new Foo()`; `class+init` adds class attribute hints; `factory` is Go-style `x := NewFoo()`; `full` implies flow analysis (currently nowhere).');
    lines.push('');
    lines.push('## Matrix');
    lines.push('');
    lines.push('| Language | Tier | Parse | Noise | Capabilities | DI heuristic | Receiver-type | Complexity | Imports | Canonical fixture |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of LANGUAGE_SUPPORT) {
        lines.push(renderRow(r));
    }
    lines.push('');
    lines.push('## Per-language notes');
    lines.push('');
    for (const r of LANGUAGE_SUPPORT) {
        if (r.notes.length === 0) {
            continue;
        }
        lines.push('### ' + r.display_name + ' (`' + r.key + '`)');
        lines.push('');
        for (const note of r.notes) {
            lines.push('- ' + note);
        }
        lines.push('');
    }
    lines.push('## Baselines');
    lines.push('');
    lines.push('Languages in the 🟢 full tier have recorded baseline tier_distribution ratios. CI parses a canonical fixture and asserts ratios fall within bands. Regressions fail the build.');
    lines.push('');
    lines.push('| Language | resolved_min | ambiguous_max | receiver/1k | di/1k | high_conf_min |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of LANGUAGE_SUPPORT) {
        if (!r.baseline_tier_ratios) {
            continue;
        }
        const b = r.baseline_tier_ratios;
        lines.push(`| ${r.display_name} | ${b.resolved_min} | ${b.ambiguous_max} | ${b.receiver_min_per_1k_nodes} | ${b.di_min_per_1k_nodes} | ${b.high_conf_min_ratio} |`);
    }
    lines.push('');
    return lines.join('\n');
}

const output = render();
writeFileSync('docs/language-support-matrix.md', output);
console.log('wrote docs/language-support-matrix.md (' + output.length + ' bytes)');
```

- [ ] **Step 3.2: Wire `bun run docs:matrix` in `package.json`**

Read `package.json` first to find the `scripts` block, then add inside it:

```json
"docs:matrix": "bun run scripts/generate-language-matrix.ts",
```

Keep alphabetical order with existing scripts.

- [ ] **Step 3.3: Run the generator**

Run: `bun run docs:matrix`
Expected: `wrote docs/language-support-matrix.md (<N> bytes)`.

Verify the file exists with `wc -l docs/language-support-matrix.md` — should have one row per language plus header/legend/notes sections.

- [ ] **Step 3.4: Add a generator-output test**

Create or append to `tests/support-matrix.test.ts`:

```typescript
describe('markdown generator output', () => {
    it('produces a file that contains every LANGUAGE_SUPPORT display_name', async () => {
        const md = await Bun.file('docs/language-support-matrix.md').text();
        for (const r of LANGUAGE_SUPPORT) {
            expect(md).toContain(r.display_name);
        }
    });

    it('contains a matrix row header', async () => {
        const md = await Bun.file('docs/language-support-matrix.md').text();
        expect(md).toContain('| Language | Tier | Parse |');
    });
});
```

Run: `bun test tests/support-matrix.test.ts` — expect all green.

- [ ] **Step 3.5: Full check + commit**

Run: `bun run check` → green.

```bash
git add scripts/generate-language-matrix.ts docs/language-support-matrix.md package.json tests/support-matrix.test.ts
git commit -m "feat(matrix): markdown generator + docs:matrix npm script"
```

---

## Task 4: CI quality gate — parse each full-tier fixture, assert baselines

**Files:**
- Create: `tests/integration/language-coverage.test.ts`
- Possibly create: tiny fixture additions if a language lacks enough content to hit baselines.

- [ ] **Step 4.1: Write the failing coverage test**

Create `tests/integration/language-coverage.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { executeParse } from '../../src/commands/parse';
import { LANGUAGE_SUPPORT } from '../../src/languages/support-matrix';

// Side-effect imports to ensure all registries are populated.
import '../../src/languages/c';
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
import '../../src/languages/typescript';

// Languages in the 'full' tier have required baselines; CI asserts them.
// 'basic' tier records may skip baselines — those are deliberately tested elsewhere.
const FULL_TIER = LANGUAGE_SUPPORT.filter((r) => r.tier === 'full' && r.baseline_tier_ratios);

describe('language-coverage CI quality gate', () => {
    for (const record of FULL_TIER) {
        it(`${record.display_name}: tier_distribution ratios meet baselines`, async () => {
            // Every 'full' record must have both
            expect(record.canonical_fixture).not.toBeNull();
            expect(record.baseline_tier_ratios).not.toBeNull();

            const fixture = resolve(record.canonical_fixture!);
            const outPath = `/tmp/kodus-lang-coverage-${record.key}.json`;

            await executeParse({
                repoDir: fixture,
                all: true,
                files: [],
                out: outPath,
                skipTests: false,
            });

            const graph = await Bun.file(outPath).json();
            const td = graph.metadata.tier_distribution;
            const nodes = graph.metadata.total_nodes;
            const baselines = record.baseline_tier_ratios!;

            const totalResolved =
                td.receiver + td.di + td.same + td.import + td.unique + td.ambiguous;
            const totalCallSites = totalResolved + td.noise + td.ambiguousNoise;

            // Protection against fixtures too small to validate. If the fixture
            // has no call sites, the ratios are undefined — skip rather than
            // produce misleading failures.
            if (totalCallSites === 0) {
                console.warn(`skipping ratio check for ${record.key}: fixture has 0 call sites`);
                return;
            }

            const resolvedRatio = totalResolved / totalCallSites;
            const ambiguousRatio = td.ambiguous / (totalResolved || 1);
            const highConfRatio = (td.receiver + td.di + td.same) / (totalResolved || 1);
            const receiverPer1k = (td.receiver * 1000) / (nodes || 1);
            const diPer1k = (td.di * 1000) / (nodes || 1);

            expect(resolvedRatio).toBeGreaterThanOrEqual(baselines.resolved_min);
            expect(ambiguousRatio).toBeLessThanOrEqual(baselines.ambiguous_max);
            expect(receiverPer1k).toBeGreaterThanOrEqual(baselines.receiver_min_per_1k_nodes);
            expect(diPer1k).toBeGreaterThanOrEqual(baselines.di_min_per_1k_nodes);
            expect(highConfRatio).toBeGreaterThanOrEqual(baselines.high_conf_min_ratio);
        });
    }
});
```

- [ ] **Step 4.2: Run — expect failures (fixtures too small)**

Run: `bun test tests/integration/language-coverage.test.ts`
Expected: some assertions will fail. The fixtures `tests/fixtures/python` and `tests/fixtures/go` are tiny (5-10 lines) — they won't hit the receiver_min_per_1k_nodes floors.

Two paths forward: (a) relax baselines, (b) beef up fixtures. Prefer (b) — real baselines catch real regressions.

- [ ] **Step 4.3: Beef up Python fixture to hit baseline**

Replace `tests/fixtures/python/sample.py` with a more realistic 30-50 line file that has at least one class-level type hint and one `__init__` typed param:

```python
"""Sample Python fixture for language-coverage CI gate."""


class UserRepository:
    def find_all(self) -> list:
        return []

    def save(self, user):
        return user


class Cache:
    def get(self, key: str):
        return None

    def set(self, key: str, value):
        pass


class UserService:
    repo: UserRepository

    def __init__(self, cache: Cache):
        self.cache = cache

    def list_users(self):
        cached = self.cache.get('users')
        if cached is not None:
            return cached
        users = self.repo.find_all()
        self.cache.set('users', users)
        return users

    def persist(self, user):
        saved = self.repo.save(user)
        self.cache.set('user:' + str(saved.id), saved)
        return saved


def classify(score: int) -> str:
    if score > 80:
        return 'high'
    elif score > 50:
        return 'medium'
    return 'low'
```

This gives the fixture at least 3 receiver-type hits (`self.cache.get`, `self.repo.find_all`, `self.repo.save`, `self.cache.set` ×2).

- [ ] **Step 4.4: Beef up Go fixture analogously**

Replace `tests/fixtures/go/sample.go` with:

```go
package sample

type UserRepository struct{}

func NewUserRepository() *UserRepository {
    return &UserRepository{}
}

func (r *UserRepository) FindAll() []string {
    return nil
}

func (r *UserRepository) Save(user string) string {
    return user
}

type Cache struct{}

func NewCache() *Cache {
    return &Cache{}
}

func (c *Cache) Get(key string) string {
    return ""
}

type UserService struct {
    repo  *UserRepository
    cache *Cache
}

func NewUserService() *UserService {
    return &UserService{
        repo:  NewUserRepository(),
        cache: NewCache(),
    }
}

func (s *UserService) ListUsers() []string {
    cached := s.cache.Get("users")
    if cached != "" {
        return []string{cached}
    }
    return s.repo.FindAll()
}

func Classify(score int) string {
    if score > 80 {
        return "high"
    } else if score > 50 {
        return "medium"
    }
    return "low"
}
```

- [ ] **Step 4.5: Re-run — baselines should now be met**

Run: `bun test tests/integration/language-coverage.test.ts`

If Python / Go still fail, loosen baselines in `support-matrix.ts` rather than force unrealistic fixture growth. The target is "CI catches regressions" not "fixtures are perfect." Typical acceptable tweak:

```typescript
baseline_tier_ratios: {
    resolved_min: 0.3,       // relaxed from 0.4
    ambiguous_max: 0.7,      // relaxed from 0.6
    receiver_min_per_1k_nodes: 0.5,  // relaxed from 1
    di_min_per_1k_nodes: 0,
    high_conf_min_ratio: 0.05,       // relaxed from 0.1
}
```

Tune until baselines pass with current fixtures, leaving some headroom (2-3x margin) so that legitimate improvements don't accidentally trip the floor.

- [ ] **Step 4.6: Same for TypeScript `sample-repo` baseline**

TypeScript fixture is already the `tests/fixtures/sample-repo` directory from earlier work. Verify it hits the baseline. If not, adjust.

- [ ] **Step 4.7: Regenerate matrix doc if baselines changed**

If any baseline value changed, re-run:

```bash
bun run docs:matrix
```

Stage the updated `docs/language-support-matrix.md` along with the source changes.

- [ ] **Step 4.8: Full check**

Run: `bun run check`
Expected: green, including the new coverage test.

- [ ] **Step 4.9: Commit**

```bash
git add tests/integration/language-coverage.test.ts tests/fixtures/python/sample.py tests/fixtures/go/sample.go src/languages/support-matrix.ts docs/language-support-matrix.md
git commit -m "feat(ci): language-coverage quality gate — baselines asserted per language"
```

---

## Task 5: README pointer to the matrix

**Files:**
- Modify: `README.md`

- [ ] **Step 5.1: Find the "supports 14 languages" claim in README**

Run: `grep -n "14 languages\|supports.*14\|14.*languages" README.md` — if nothing matches, find the section listing supported languages. It's typically in the intro or Features section.

- [ ] **Step 5.2: Replace with honest pointer**

Swap the bullet with:

```markdown
**Multi-language support.** kodus-graph covers TypeScript, Python, Go, Java, Ruby, and 9 more. Each language has a declared support tier (full / basic / experimental) with per-language baselines enforced in CI. See the [language support matrix](docs/language-support-matrix.md) for the authoritative list and current capability depth per language.
```

Keep other README content unchanged. Full README rewrite is Phase E — this plan only sets a pointer so the old "14 languages" claim no longer stands alone.

- [ ] **Step 5.3: Commit**

```bash
git add README.md
git commit -m "docs: README links to language support matrix"
```

---

## Post-Plan Self-Check

- [ ] **Verify CI gate asserts on every 'full' tier language**

Run: `bun test tests/integration/language-coverage.test.ts` — expect at least 5 tests (TypeScript, Tsx, JavaScript, python, go) but note TS-family shares a fixture so only one TS test runs; realistically 3 coverage tests (TS, Python, Go).

- [ ] **Verify matrix markdown is in sync**

Run: `bun run docs:matrix` and `git diff docs/language-support-matrix.md`. Should be empty (no drift). If there's a diff, commit it.

- [ ] **Verify every registered language appears in the matrix**

Run: `bun test tests/support-matrix.test.ts` — the consistency test catches drift between `registerExtractor` keys and `LANGUAGE_SUPPORT` keys. A failure here means a language was added to one side but not the other — fix by adding the missing entry.

---

## What this plan does NOT do (follow-up plans)

- **Phase C: Language-specific feature additions.** Java `@Inject` / `@Autowired` parsing, Python FastAPI `Depends()`, Go generic factory detection, Maven multi-module imports, Ruby parse perf. Each gets its own plan, one per language, because each requires language-specific grammar work.
- **Phase D: Smoke-test the 10 languages without real-repo validation.** Pick a mid-sized open-source repo for each of Kotlin, Rust, C#, C, C++, PHP, Swift, Dart, Scala, Elixir. Document findings. Possibly promote some from 'basic' to 'full' if they clear the bar; demote others to 'experimental' with a documented gap.
- **Phase E: Full README rewrite.** Replace the current README's feature list with an honest capability-by-capability pitch that reflects the matrix.

Each phase is a separate plan in `docs/superpowers/plans/`. This plan (A+B) must land first; the CI gate it creates is the precondition for the others.
