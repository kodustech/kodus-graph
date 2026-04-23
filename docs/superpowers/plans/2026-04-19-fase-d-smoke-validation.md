# Fase D — Smoke Validation of 10 Basic-Tier Languages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exercise each of the 10 `basic`-tier languages (Kotlin, Rust, C#, C, C++, PHP, Swift, Dart, Scala, Elixir) against a real open-source repository. Produce per-language validation reports with concrete metrics. Promote languages that clear the quality bar to `full` tier; add documented notes to those that don't.

**Architecture:** A reusable validation harness (`scripts/validate-language.ts`) encapsulates the repeatable work — takes a cloned repo path + language key, runs `kodus-graph parse`, extracts metrics, writes a markdown report, cleans up the graph JSON. Each per-language task shallow-clones a target repo, invokes the harness, commits the resulting report, and deletes the clone. A final consolidation task aggregates findings and updates `src/languages/support-matrix.ts` + regenerates the matrix doc.

**Tech Stack:** TypeScript (strict), Bun runtime, existing kodus-graph CLI, git shallow clone.

**Prerequisites:**
- Matrix Plan (2026-04-19-language-support-matrix.md) merged. `LANGUAGE_SUPPORT` has 14 basic-tier records awaiting real-repo validation. CI gate already enforces full-tier baselines.
- Branch: `feat/fase-d-smoke-validation` off main.
- Disk: ~10 GB free in `$HOME`. Plan budgets cloned repo + graph.json ≤ 2 GB simultaneously, aggressive cleanup between tasks.

**Out of scope (separate plans):**
- Fixing gaps discovered by the smoke tests — each fix is a separate plan (Java `@Inject`, Python `Depends()`, Ruby streaming, etc.).
- Cloning repos that exceed 500 MB shallow (too expensive; pick a smaller representative).
- Re-running validation on the 5 already-tested `full`/partial repos (sentry, calcom, grafana, keycloak, discourse).

---

## File Structure

### New files

- `scripts/validate-language.ts` — harness. Takes `--repo <path> --lang <key> --out <path>`. Runs parse, computes metrics, writes markdown report, removes graph JSON. Idempotent — re-running overwrites the report.
- `docs/language-validation/<lang>.md` — one file per validated language. Committed as snapshot of state at validation time.
- `docs/language-validation/README.md` — index listing every language, its validation date, and a one-line outcome.

### Modified files (only by the consolidation task)

- `src/languages/support-matrix.ts` — promote any language that cleared bar from `basic` → `full`, add baseline ratios, add notes citing validation evidence.
- `docs/language-support-matrix.md` — regenerated from updated `LANGUAGE_SUPPORT`.

### Per-task ephemeral state

- `/tmp/fase-d/<lang>/` — shallow clone destination. Deleted after report is written.
- `/tmp/fase-d/<lang>-graph.json` — temp graph output. Deleted after metrics extracted.

---

## Task 1: Validation harness (`scripts/validate-language.ts`)

**Files:**
- Create: `scripts/validate-language.ts`
- Create: `docs/language-validation/README.md` (index, starts empty, filled by per-language tasks)

### Step 1.1: Write the harness

Create `scripts/validate-language.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Smoke-validation harness for Fase D.
 *
 * Usage:
 *   bun run scripts/validate-language.ts --repo <clone-path> --lang <key> --out <report-path>
 *
 * Runs kodus-graph `parse --all` on the repo, extracts tier_distribution,
 * language breakdown, alternatives coverage, complexity coverage, high-conf
 * edge count. Writes a markdown report. Deletes the intermediate graph JSON.
 *
 * Always uses `--max-memory 1024` so large repos don't thrash.
 * Excludes node_modules / vendor / target / .git / build / dist / __pycache__ / venv.
 */
import { existsSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';

interface Args {
    repo: string;
    lang: string;
    out: string;
}

function parseArgs(): Args {
    const args: Partial<Args> = {};
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i];
        const value = process.argv[i + 1];
        if (key === '--repo') args.repo = value;
        if (key === '--lang') args.lang = value;
        if (key === '--out') args.out = value;
    }
    if (!args.repo || !args.lang || !args.out) {
        throw new Error('Usage: validate-language --repo <path> --lang <key> --out <report-path>');
    }
    return args as Args;
}

async function main(): Promise<void> {
    const { repo, lang, out } = parseArgs();
    if (!existsSync(repo)) {
        throw new Error(`repo not found: ${repo}`);
    }

    const tmpGraph = `/tmp/fase-d-${lang}-graph.json`;
    const started = Date.now();

    const parseResult = spawnSync(
        'bun',
        [
            'run',
            'src/cli.ts',
            'parse',
            '--all',
            '--repo-dir',
            repo,
            '--out',
            tmpGraph,
            '--max-memory',
            '1024',
            '--exclude',
            '**/node_modules/**',
            '**/vendor/**',
            '**/.git/**',
            '**/target/**',
            '**/build/**',
            '**/dist/**',
            '**/__pycache__/**',
            '**/venv/**',
            '**/.venv/**',
        ],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const parseStderr = parseResult.stderr || '';
    const parseExit = parseResult.status;

    if (parseExit !== 0 || !existsSync(tmpGraph)) {
        const report = buildFailureReport({ lang, repo, elapsed, parseExit, parseStderr });
        await Bun.write(out, report);
        console.log(`FAIL: parse exited ${parseExit}. Report at ${out}`);
        if (existsSync(tmpGraph)) {
            rmSync(tmpGraph);
        }
        process.exit(1);
    }

    const graph = await Bun.file(tmpGraph).json();
    const metrics = computeMetrics(graph);

    const report = buildSuccessReport({ lang, repo, elapsed, metrics, parseStderr });
    await Bun.write(out, report);

    rmSync(tmpGraph);
    console.log(`OK: ${lang} — report at ${out}`);
}

interface Metrics {
    files_parsed: number;
    total_nodes: number;
    total_edges: number;
    parse_errors: number;
    extract_errors: number;
    tier_distribution: Record<string, number>;
    languages: Record<string, number>;
    fn_count: number;
    complexity_coverage_ratio: number;
    ambiguous_count: number;
    alternatives_ratio: number;
    high_conf_count: number;
    high_conf_ratio: number;
    resolved_ratio: number;
    passes_full_tier_bar: boolean;
    bar_failures: string[];
}

function computeMetrics(graph: { metadata: Record<string, unknown>; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }): Metrics {
    const metadata = graph.metadata;
    const td = (metadata.tier_distribution as Record<string, number>) ?? {};

    const langs: Record<string, number> = {};
    for (const n of graph.nodes) {
        const k = String(n.language ?? 'unknown');
        langs[k] = (langs[k] ?? 0) + 1;
    }

    const fns = graph.nodes.filter((n) => n.kind === 'Function' || n.kind === 'Method');
    const withCpx = fns.filter((n) => typeof n.complexity === 'number');

    const ambig = graph.edges.filter((e) => e.confidence === 0.3);
    const withAlt = ambig.filter((e) => Array.isArray(e.alternatives) && (e.alternatives as unknown[]).length > 0);

    const highConf = graph.edges.filter(
        (e) => e.kind === 'CALLS' && (e.confidence === 0.95 || e.confidence === 0.9),
    );

    const totalResolved =
        (td.receiver ?? 0) + (td.di ?? 0) + (td.same ?? 0) + (td.import ?? 0) + (td.unique ?? 0) + (td.ambiguous ?? 0);
    const totalCallSites = totalResolved + (td.noise ?? 0) + (td.ambiguousNoise ?? 0);
    const resolvedRatio = totalCallSites === 0 ? 0 : totalResolved / totalCallSites;
    const ambigRatio = totalResolved === 0 ? 0 : (td.ambiguous ?? 0) / totalResolved;
    const highConfRatio = totalResolved === 0 ? 0 : ((td.receiver ?? 0) + (td.di ?? 0) + (td.same ?? 0)) / totalResolved;
    const nodes = Number(metadata.total_nodes ?? 0);
    const receiverPer1k = nodes === 0 ? 0 : ((td.receiver ?? 0) * 1000) / nodes;
    const diPer1k = nodes === 0 ? 0 : ((td.di ?? 0) * 1000) / nodes;

    // Apply the same full-tier bar CI enforces (loose floor of the two real
    // full languages: python + go).
    const bar_failures: string[] = [];
    if (resolvedRatio < 0.4) bar_failures.push(`resolvedRatio ${resolvedRatio.toFixed(3)} < 0.4`);
    if (ambigRatio > 0.6) bar_failures.push(`ambigRatio ${ambigRatio.toFixed(3)} > 0.6`);
    if (receiverPer1k < 1 && diPer1k < 1) bar_failures.push(`receiver+di per-1k both < 1`);
    if (highConfRatio < 0.1) bar_failures.push(`highConfRatio ${highConfRatio.toFixed(3)} < 0.1`);
    if ((metadata.parse_errors as number) > 0) bar_failures.push(`parse_errors > 0`);
    if ((metadata.extract_errors as number) > 0) bar_failures.push(`extract_errors > 0`);

    return {
        files_parsed: Number(metadata.files_parsed ?? 0),
        total_nodes: Number(metadata.total_nodes ?? 0),
        total_edges: Number(metadata.total_edges ?? 0),
        parse_errors: Number(metadata.parse_errors ?? 0),
        extract_errors: Number(metadata.extract_errors ?? 0),
        tier_distribution: td,
        languages: langs,
        fn_count: fns.length,
        complexity_coverage_ratio: fns.length === 0 ? 0 : withCpx.length / fns.length,
        ambiguous_count: ambig.length,
        alternatives_ratio: ambig.length === 0 ? 0 : withAlt.length / ambig.length,
        high_conf_count: highConf.length,
        high_conf_ratio: highConfRatio,
        resolved_ratio: resolvedRatio,
        passes_full_tier_bar: bar_failures.length === 0,
        bar_failures,
    };
}

function buildFailureReport(args: { lang: string; repo: string; elapsed: string; parseExit: number | null; parseStderr: string }): string {
    return [
        `# ${args.lang} validation — PARSE FAILED`,
        '',
        `- repo: \`${args.repo}\``,
        `- parse duration: ${args.elapsed}s`,
        `- exit code: ${args.parseExit}`,
        '',
        '## Last lines of stderr',
        '',
        '```',
        args.parseStderr.split('\n').slice(-30).join('\n'),
        '```',
        '',
        '## Verdict',
        '',
        '**Parse failed. Language needs investigation before it can be promoted beyond basic tier.**',
        '',
    ].join('\n');
}

function buildSuccessReport(args: { lang: string; repo: string; elapsed: string; metrics: Metrics; parseStderr: string }): string {
    const m = args.metrics;
    const tierIcon = m.passes_full_tier_bar ? '🟢' : '🟡';
    const verdict = m.passes_full_tier_bar
        ? `Clears the full-tier bar. Candidate for promotion.`
        : `Does NOT clear the full-tier bar. See failures below.`;

    const langBreakdown = Object.entries(m.languages)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

    const tierLines = Object.entries(m.tier_distribution)
        .map(([k, v]) => `| ${k} | ${v} |`)
        .join('\n');

    return [
        `# ${args.lang} validation — ${tierIcon} ${m.passes_full_tier_bar ? 'PASS' : 'GAP'}`,
        '',
        `- repo: \`${args.repo}\``,
        `- parse duration: ${args.elapsed}s`,
        `- files_parsed: ${m.files_parsed}`,
        `- nodes / edges: ${m.total_nodes} / ${m.total_edges}`,
        `- parse_errors: ${m.parse_errors}`,
        `- extract_errors: ${m.extract_errors}`,
        '',
        '## Verdict',
        '',
        verdict,
        '',
        m.bar_failures.length === 0
            ? '(no bar failures)'
            : '### Bar failures\n\n' + m.bar_failures.map((f) => `- ${f}`).join('\n'),
        '',
        '## Language breakdown (nodes by language)',
        '',
        langBreakdown,
        '',
        '## tier_distribution',
        '',
        '| tier | count |',
        '|---|---|',
        tierLines,
        '',
        '## Quality signals',
        '',
        `- functions with complexity: **${(m.complexity_coverage_ratio * 100).toFixed(1)}%** (${m.fn_count} total)`,
        `- ambiguous edges with alternatives[]: **${(m.alternatives_ratio * 100).toFixed(1)}%** (${m.ambiguous_count} ambiguous)`,
        `- high-confidence CALLS (0.9/0.95): **${m.high_conf_count}** (${(m.high_conf_ratio * 100).toFixed(1)}% of resolved)`,
        `- resolved ratio (resolved / total call sites): **${(m.resolved_ratio * 100).toFixed(1)}%**`,
        '',
        '## Proposed baselines (if promoting to full)',
        '',
        m.passes_full_tier_bar
            ? '```typescript\n' +
              'baseline_tier_ratios: {\n' +
              `    resolved_min: ${Math.max(0, m.resolved_ratio - 0.1).toFixed(2)},\n` +
              `    ambiguous_max: ${Math.min(1, (m.tier_distribution.ambiguous ?? 0) / (m.total_edges || 1) + 0.15).toFixed(2)},\n` +
              `    receiver_min_per_1k_nodes: ${Math.max(0, ((m.tier_distribution.receiver ?? 0) * 1000) / (m.total_nodes || 1) - 2).toFixed(1)},\n` +
              `    di_min_per_1k_nodes: ${Math.max(0, ((m.tier_distribution.di ?? 0) * 1000) / (m.total_nodes || 1) - 2).toFixed(1)},\n` +
              `    high_conf_min_ratio: ${Math.max(0, m.high_conf_ratio - 0.05).toFixed(2)},\n` +
              '},\n' +
              '```'
            : '(skipped — does not clear bar)',
        '',
    ].join('\n');
}

main().catch((err) => {
    console.error('harness crash:', err);
    process.exit(1);
});
```

### Step 1.2: Create the empty index

Create `docs/language-validation/README.md`:

```markdown
# Language validation reports

One markdown report per language exercised against a real open-source
repository as part of Fase D. Numbers are snapshots; re-running the
validation harness overwrites the corresponding file.

Updated by `scripts/validate-language.ts` during Fase D task execution,
then consolidated in `src/languages/support-matrix.ts` (tier updates,
baselines, notes) by the final task of the Fase D plan.

| Language | Repo | Date | Verdict |
|---|---|---|---|
```

Leave the table empty — each per-language task appends one row.

### Step 1.3: Make harness executable + smoke-test it

Run the harness against an already-validated repo to confirm it produces a sensible report without promoting things incorrectly:

```bash
mkdir -p /tmp/fase-d
bun run scripts/validate-language.ts \
  --repo /Users/wellingtonsantana/Documents/kodus-git/projects-trd/sentry-greptile-test \
  --lang sentry-smoke-test \
  --out /tmp/fase-d/sentry-smoke-test.md
```

Read the resulting markdown. Should show concrete metrics (resolvedRatio around 0.6, alternative coverage, etc.) and a verdict. If the output looks nonsensical (e.g. all zeros), fix the harness.

Delete the smoke-test report:

```bash
rm /tmp/fase-d/sentry-smoke-test.md
```

### Step 1.4: Commit

```bash
git add scripts/validate-language.ts docs/language-validation/README.md
git commit -m "feat(validation): Fase D harness and report index"
```

## Rules for Task 1

- **Don't parameterize more than needed.** The harness always uses `--max-memory 1024` and the exclude list above. If a language needs different excludes, add a `--extra-exclude` flag in a later task. YAGNI.
- **The harness MUST delete the graph JSON** after extracting metrics. Disk budget is tight.
- **Markdown output is the contract.** Per-language tasks read `docs/language-validation/<lang>.md` to decide whether to promote. Keep the format stable.

---

## Task 2–11: Per-language validation (10 tasks, one per language)

Each language task follows the same pattern. The specific repo, expected parse time, and notes differ. All 10 have the SAME 5 steps.

### Common step pattern

For each language task:

- [ ] **Step X.1: Shallow-clone the target repo**

```bash
mkdir -p /tmp/fase-d
cd /tmp/fase-d
git clone --depth=1 <REPO_URL> <LANG>
du -sh <LANG>
```

Expected: repo clones in < 90 seconds, directory size < 150 MB.

- [ ] **Step X.2: Run the validation harness**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
bun run scripts/validate-language.ts \
  --repo /tmp/fase-d/<LANG> \
  --lang <LANG_KEY> \
  --out docs/language-validation/<LANG_KEY>.md
```

Expected: exit 0 when parse succeeds. Exit 1 (with failure report) when parse crashes — both are valid outcomes to commit.

- [ ] **Step X.3: Inspect the report and note the verdict**

```bash
cat docs/language-validation/<LANG_KEY>.md | head -40
```

Record in the PR commit message: verdict (PASS / GAP / PARSE FAILED), resolved ratio, high-conf count, any surprises.

- [ ] **Step X.4: Delete the cloned repo**

```bash
rm -rf /tmp/fase-d/<LANG>
```

Critical for disk budget.

- [ ] **Step X.5: Update the index**

Append one row to `docs/language-validation/README.md`:

```markdown
| <LANG_KEY> | [<REPO_URL>](<REPO_URL>) | YYYY-MM-DD | 🟢 PASS / 🟡 GAP / 🔴 FAIL |
```

- [ ] **Step X.6: Commit**

```bash
git add docs/language-validation/<LANG_KEY>.md docs/language-validation/README.md
git commit -m "validation(<LANG_KEY>): smoke-test against <REPO_SHORT_NAME>"
```

### Per-language specifics

The tasks differ only in the target repo. Each task below gives exact URL + expected scale.

#### Task 2: Kotlin

**REPO_URL:** `https://github.com/Kotlin/kotlinx.coroutines`
**LANG_KEY:** `kotlin`
**Expected scale:** ~200 Kotlin files, shallow clone ~30 MB.
**Notes:** `kotlinx.coroutines` is the canonical Kotlin library. Realistic idioms (coroutines, suspend, nullability) without being a huge monorepo. If clone fails, fall back to `https://github.com/arrow-kt/arrow`.

#### Task 3: Rust

**REPO_URL:** `https://github.com/tokio-rs/tokio`
**LANG_KEY:** `rust`
**Expected scale:** ~600 Rust files, shallow clone ~40 MB.
**Notes:** Tokio is the Rust async runtime — high-quality idiomatic Rust with traits, lifetimes, macros. If clone fails, fall back to `https://github.com/rust-lang/cargo` (larger).

#### Task 4: C#

**REPO_URL:** `https://github.com/serilog/serilog`
**LANG_KEY:** `csharp`
**Expected scale:** ~150 C# files, shallow clone ~10 MB.
**Notes:** Serilog is a clean C# library. Realistic interfaces, DI patterns. Fallback: `https://github.com/aspnet-contrib/AspNet.Security.OpenIdConnect.Server` if Serilog is too small.

#### Task 5: C

**REPO_URL:** `https://github.com/redis/redis`
**LANG_KEY:** `c`
**Expected scale:** ~300 C files, shallow clone ~60 MB.
**Notes:** Redis is a canonical C codebase. If parse takes >5 min, note performance and move on.

#### Task 6: C++

**REPO_URL:** `https://github.com/google/flatbuffers`
**LANG_KEY:** `cpp`
**Expected scale:** ~200 C++ files, shallow clone ~40 MB.
**Notes:** Google flatbuffers — realistic C++ with templates, namespaces. Fallback: `https://github.com/nlohmann/json` (header-only, smaller).

#### Task 7: PHP

**REPO_URL:** `https://github.com/laravel/framework`
**LANG_KEY:** `php`
**Expected scale:** ~2000 PHP files, shallow clone ~50 MB.
**Notes:** Laravel framework core. Tons of dependency injection — worth checking if our PHP DI heuristic (`UserServiceImpl`) fires.

#### Task 8: Swift

**REPO_URL:** `https://github.com/apple/swift-package-manager`
**LANG_KEY:** `swift`
**Expected scale:** ~800 Swift files, shallow clone ~40 MB.
**Notes:** Apple's SwiftPM — idiomatic Swift, protocols, generics.

#### Task 9: Dart

**REPO_URL:** `https://github.com/google/quiver-dart`
**LANG_KEY:** `dart`
**Expected scale:** ~100 Dart files, shallow clone ~5 MB.
**Notes:** Small but representative Dart library. Member-call extraction was fixed in Phase 3.5 (commit d48a9ee); this is the first real-repo test of that fix.

#### Task 10: Scala

**REPO_URL:** `https://github.com/com-lihaoyi/mill`
**LANG_KEY:** `scala`
**Expected scale:** ~400 Scala files, shallow clone ~30 MB.
**Notes:** Mill is a Scala build tool — idiomatic Scala, traits, objects. Fallback: `https://github.com/akka/akka-http` if the Mill clone fails.

#### Task 11: Elixir

**REPO_URL:** `https://github.com/phoenixframework/phoenix`
**LANG_KEY:** `elixir`
**Expected scale:** ~300 Elixir files, shallow clone ~20 MB.
**Notes:** Phoenix framework — pattern matching, behaviours, macros. Our Elixir complexity helper (strict McCabe via call+stab_clause, fixed in bd3bc48) gets its first real-repo test.

### Handling failures

For each per-language task:

- **Parse crashes outright:** harness writes a FAILURE report. Commit it. The language is a known gap; downgrade to `experimental` in the final consolidation task.
- **Parse completes but metrics are absurd** (e.g. 0 functions from a real repo): investigate quickly. If it's a language-specific parser bug, STOP and report; may need a small fix before continuing. If it's a fixture / exclude issue, adjust the run and re-record.
- **Parse takes >10 minutes:** kill the process, record the partial state, note "slow — optimization needed" in the report.

---

## Task 12: Consolidate findings into `LANGUAGE_SUPPORT` + regenerate matrix doc

**Files:**
- Modify: `src/languages/support-matrix.ts`
- Modify: `docs/language-support-matrix.md` (regenerated)
- Modify: `docs/language-validation/README.md` (ensure all 10 rows present)

### Step 12.1: Read all 10 reports

```bash
for lang in kotlin rust csharp c cpp php swift dart scala elixir; do
    echo "=== $lang ==="
    head -10 docs/language-validation/$lang.md
    echo
done
```

For each report, extract: verdict (PASS/GAP/FAIL), proposed baselines (if PASS).

### Step 12.2: Classify each of the 10 languages

Bucket them:

- **PASS → promote to `full` tier.** Add `canonical_fixture` and `baseline_tier_ratios` using the proposed baselines from the report. Keep the fixture as the existing `tests/fixtures/<lang>/` directory (unit-test fixture, small). CI `language-coverage` test will auto-pick them up.
- **GAP → keep at `basic` tier.** Add one or more `notes` citing the specific failure: "`resolvedRatio 0.32 < 0.4 on <repo>` — real-repo signal weaker than fixture."
- **PARSE FAILED → demote to `experimental` tier.** Add `notes` with the exact failure (parser crash, grammar mismatch). Leave `canonical_fixture: null`, `baseline_tier_ratios: null`.

### Step 12.3: Apply changes to `src/languages/support-matrix.ts`

For each language that changes tier, edit the corresponding record.

**Promotion example (kotlin passes):**

```typescript
{
    key: 'kotlin',
    display_name: 'Kotlin',
    tier: 'full',                                           // was 'basic'
    parse_speed: 'moderate',
    features: { /* unchanged */ },
    canonical_fixture: 'tests/fixtures/kotlin',             // was null
    baseline_tier_ratios: {                                 // was null — use harness-proposed values
        resolved_min: 0.40,
        ambiguous_max: 0.55,
        receiver_min_per_1k_nodes: 3,
        di_min_per_1k_nodes: 0,
        high_conf_min_ratio: 0.15,
    },
    notes: ['Reuses Java DI heuristic', 'Validated on kotlinx.coroutines'],
},
```

**GAP example (if kotlin had gaps instead):**

```typescript
notes: [
    'Reuses Java DI heuristic',
    'Not validated on real repo',
    'kotlinx.coroutines smoke test: resolvedRatio 0.32 < 0.4 bar; ambigRatio 0.70 > 0.6 (Kotlin method-name reuse)',
],
```

**Experimental example (if parse crashed):**

```typescript
{
    key: '<lang>',
    display_name: '<Lang>',
    tier: 'experimental',                                   // was 'basic'
    // ...
    notes: ['Parse crashed on <repo>: <error>', 'Needs investigation before it can be promoted'],
},
```

### Step 12.4: Regenerate docs

```bash
bun run docs:matrix
```

Stage the updated `docs/language-support-matrix.md`.

### Step 12.5: Run the full check

```bash
bun run check
```

Expected: green. Promoted languages now have baseline_tier_ratios — the `language-coverage.test.ts` CI gate will try them against their tiny fixtures. If a tiny fixture can't hit the real-repo-derived baseline, the implementer has two options:

1. **Loosen the baseline** — the baseline should reflect what the CI fixture can reliably produce, not the real repo. Real repo numbers inform the baseline but CI fixtures are small; headroom matters.
2. **Beef up the fixture** — the `tests/fixtures/<lang>/` is usually tiny. Adding a 30-50-line file with OO patterns (class, method calls) often brings the fixture up to bar.

Reuse the templates from the matrix plan's Task 4 (Python / Go `UserService + Cache + UserRepository` style) adapted to the target language's syntax.

### Step 12.6: Commit

```bash
git add src/languages/support-matrix.ts docs/language-support-matrix.md tests/fixtures
git commit -m "feat(matrix): Fase D consolidation — tier updates based on real-repo validation"
```

---

## Post-Plan Verification

- [ ] **All 10 reports exist and are committed.**

```bash
ls docs/language-validation/
```

Expected: 11 files (10 languages + README.md index).

- [ ] **Index is populated.**

```bash
grep -c "^|" docs/language-validation/README.md
```

Expected: at least 12 rows (header + 10 languages + separator).

- [ ] **CI gate picks up promoted languages.**

```bash
bun test tests/integration/language-coverage.test.ts
```

Each promoted language should produce a passing test.

- [ ] **Matrix doc reflects reality.**

```bash
bun run docs:matrix
git diff docs/language-support-matrix.md
```

Should be empty (no drift).

---

## Scope Boundary — What This Plan Does NOT Do

- **Fix anything identified as a gap.** GAPs → documented notes only. Per-language fixes are separate plans (Java `@Inject`, Python `Depends()`, etc.).
- **Write new extractors.** If a language has a PARSE FAILED verdict, it goes to `experimental` and a separate investigation plan handles the fix.
- **Re-validate the 5 already-tested repos.** Those stay as-is; their validation reports live elsewhere (`/tmp/kodus-validation/*/REPORT.md` from prior session).
- **Write per-language DI heuristics.** Separate plans.
- **Refactor the matrix schema.** Adding fields would break Task 2 of the matrix plan's consistency test.

Each decision above is a deliberate choice: this plan's output is ground truth about what currently works. Fixes come next, with evidence in hand.
