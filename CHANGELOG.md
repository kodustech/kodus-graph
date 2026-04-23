# Changelog

All notable changes to kodus-graph are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-04-23

Two-session run: hardcode elimination, receiver-type inference, schema v2.0,
real-repo validation, and Fase D smoke validation across 10 languages.

### Breaking Changes

- **Schema v2.0** — `metadata.schema_version` now `"2.0"`. Graph loaders
  refuse newer majors and warn on legacy `"1.0"`. Consumers reading
  `GraphNode.language` must accept canonical registry keys (e.g. `python`,
  `csharp`) instead of ad-hoc display strings.
- `LANGUAGE_SUPPORT` matrix is the new single source of truth for supported
  languages, replacing scattered boolean flags. Downstream tooling that
  inspected `GraphNode.language` casually may see normalized keys.

### Added

- **Schema versioning** — `schema_version` threaded through `ParseMetadata`;
  `parse`, `analyze`, `context`, and library loaders enforce it.
- **Receiver-type tier** — scope-local `const x = new Foo()` inference across
  10+ languages; Python `self.attr` via class attrs + `__init__` typed
  params; Go `x := NewFoo()` factory sniff. Resolver prefers receiver tier
  over name-based cascade (0.95 confidence).
- **Per-language registries** — noise, DI heuristics, capabilities
  (`hasAsync`/`hasExceptions`/`hasDecorators`), receiver-type inference. No
  global hardcoded sets remain.
- **Statistical `ambiguousNoise`** — threshold derived from symbol table,
  not a hardcoded list.
- **Alternatives on ambiguous edges** — `alternatives[]` populated so LLM
  reviewers see candidate targets. 99.4% coverage on ambiguous calls.
- **Cyclomatic complexity** — populated in all 14 extractors; threaded
  through `ExtractedFunction` and used by risk scoring (LoC fallback for
  legacy graphs).
- **Configurable risk weights** — `--risk-config` accepts object or path.
- **`tier_distribution` metadata** — surfaces resolver confidence mix per
  repo (receiver / di / same / import / unique / ambiguous / noise /
  ambiguousNoise).
- **Member-call extraction** — Java, Dart, Python now capture `x.method()`.
- **Language support matrix** — `src/languages/support-matrix.ts` +
  `docs/language-support-matrix.md`. Tiers: `full` / `basic` /
  `experimental`. CI gate asserts per-language baselines
  (`tests/integration/language-coverage.test.ts`).
- **Fase D validation harness** — `scripts/validate-language.ts` produces
  per-language markdown reports in `docs/language-validation/`.
- **Full-tier promotion** — 3 → 8 full-tier languages: TypeScript, Python,
  Go (already full), plus C#, Swift, Scala, Dart, Elixir (validated on
  serilog, swift-package-manager, mill, quiver-dart, phoenix).

### Changed

- **Resolver order** — receiver-type tier runs before noise filter
  (symbol-table-guarded) so user-domain calls don't get dropped.
- **Pre-computed `GraphIndex`** — risk and blast-radius no longer do
  linear scans.
- **Contract diff rendering** — token-level diff for long params/return
  types, plus whitespace/format normalization to eliminate false
  positives.
- **ReviewFocus XML** — one focus per function with combined concerns
  (was one per concern → duplicates).
- **`GraphNode.language`** — normalized to canonical registry keys.
- **Batch reducer** — grows back after memory pressure clears; yields
  only on `shrink` action (not on hold-at-floor).

### Fixed

- `--max-memory` now throttles correctly (floor was 5, reducer stalled).
  Sentry RSS: 1872MB → 747MB at `--max-memory 512`.
- `diff --base <ref>` now reads base-ref content via `git show` instead
  of comparing HEAD against HEAD. Sentry `HEAD~5`: 0 → 18 changes.
- `search --limit` now respected by `--callers-of` / `--callees-of`;
  added `returned` field so consumers can detect truncation.
- `test_gaps` array aligned with risk score (was semantic mismatch).
- Whitespace-only diffs no longer produce false-positive contract
  changes.
- Elixir cyclomatic complexity: strict McCabe for `case`/`cond`/`with`/
  `try` (was double-counting).

### Validation

- Real-repo runs on `projects-trd/sentry-greptile-test` (779MB, 14k
  files), `calcom-greptile-test` (1GB), `grafana-greptile-test` (1.2GB),
  `keycloak-greptile-test` (801MB), `discourse-greptile-test` (432MB).
- Fase D smoke validation on 10 registered languages:
  - 🟢 PASS: rust (tokio), csharp (serilog), cpp (flatbuffers), swift
    (swift-package-manager), dart (quiver-dart), scala (mill), elixir
    (phoenix).
  - 🟡 GAP: kotlin (ambigRatio 0.683 — Kotlin method-name reuse), c
    (receiver-type: none), php (call-site extractor too thin: 10 edges
    across 28508 functions in laravel).
- All 1057 tests pass; 8/8 full-tier CI baselines pass.

### Known Limitations (non-blocking)

- PHP call-site extraction too thin — needs investigation.
- Rust and C++ real-repo PASS but fixtures too small for CI baselines;
  stay at `basic` until fixtures are beefed up.
- Kotlin and Java use `@Inject`/`@Autowired` in practice — not parsed.
- Ruby large-repo parse slow (~12 min on discourse 11k files) — ast-grep
  Ruby grammar bottleneck.
- Multi-module Maven import resolution ~2% on keycloak.
