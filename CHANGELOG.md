# Changelog

All notable changes to kodus-graph are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-06-24

The "grammar-drift guard" release. Per-language extractors no longer carry
tree-sitter kind strings as scattered literals — a `@ast-grep/lang-*` bump
that renamed a node kind used to break extraction silently. New `outline`
command, a measured receiver-type speedup, and a now-stable test gate.

### Highlights

- **New `kodus-graph outline` command** — a compact structural outline of a
  file's symbols (signature, line range, flags), parse-on-demand and
  local-only. With `--graph` it enriches each symbol with cross-file CALLS
  fan-in/fan-out, and with `--blast` the blast-radius size — the impact view
  a purely syntactic outline can't produce.
- **Grammar-drift guards for all 14 languages** — every node kind a
  per-language extractor matches now lives in a typed `kinds.ts` (`as const`)
  with a sanity test that fails if the grammar stops emitting it. A typo is a
  compile error; a grammar rename is a red test, not a silently empty graph.
- **`@ast-grep/napi` 0.42 → 0.44** on a single package manager (Bun); the
  duplicate, out-of-sync `yarn.lock` is gone.

### Added

- **`outline` command** — `--files`/`--dir`, `--format text|json`,
  `--exported-only`, `--graph` (CALLS fan-in/out), `--blast` (blast-radius
  size), `--max-depth`, `--out -`. Methods nest under their declaring class.

### Changed — Internal / anti-fragility

- **Centralized tree-sitter kinds (14 languages)** — each extractor consumes a
  dedicated `src/languages/<lang>/kinds.ts` (and `*_FIELDS` where field names
  are used). The shared `LANG_KINDS` map is deleted.
- **Dead cross-language code removed** — the kinds-sanity guards exposed
  branches copied between extractors that the grammar can never emit (Rust
  `impl`/`use_tree`/`scoped_identifier`, JS `string_fragment`, C++
  `namespace_name`, dart `default_formal_parameter`, python
  `async_function_definition`, ts `nested_identifier`, plus C#'s
  `type_identifier`/`parameter_modifier`). Each verified absent from the
  grammar's `node-types.json`; behavior-identical.
- **Shared `stripImportKeyword` helper** — the byte-identical import text
  fallback, deduplicated across 8 C-style extractors.
- **`java/kinds.ts` keys to camelCase** — consistent with the other 13.

### Performance

- **Receiver-type scope index** — replaced the per-call O(calls × scopes)
  containment scan (TS + Python) with a precomputed scope index: an O(1)
  `boundNames` gate plus a smallest-first early break. Byte-identical output,
  ~20% faster receiver-type inference (measured on a 2500-file sample;
  concentrated on the large files that drove the quadratic).
- **`outline` impact map** — container lookup is O(1) (Map by name) and
  `buildImpactMap` scores only the outlined nodes, not the whole graph
  (avoids O(V × E) / OOM with `--blast`).

### Fixed

- **Flaky test gate** — full `bun test` runs intermittently failed (~1-in-5)
  at a 5000ms filesystem setup/cleanup timeout; Bun 1.3.x doesn't honor the
  `bunfig.toml` `[test] timeout`. Set `--timeout 30000` via the `test`
  script. 12/12 consecutive green runs.

## [0.4.0] — 2026-05-01

The "honest receiver tier" release. Two latent extractor bugs were silently
neutralizing 95% of Java's receiver-tier work; fixing them moved keycloak
from 0.745 → 0.430 ambiguous ratio. Java promoted from `basic` to `full`.
Eight new resolver capabilities, cross-file aggregation, and structural
extractor fixes across multiple languages.

### Highlights

- **Java promoted to full tier 🟢** — keycloak (7657 files) clears the bar:
  resolved 94.3%, ambig 43.0%, receiver 1620/1k. Was `basic` with 0.745
  ambig before.
- **Cross-file aggregation** — receiver type now resolves cross-file via
  `@CALLEE:` (deferred return type) and `@IMPORT:` (deferred imported
  binding) markers. Six languages.
- **Six latent extractor bugs fixed** — Java/Kotlin/C#/Go all had
  silent `field('return_type')` mismatches that crippled chain-pass +
  deferred-callee for those languages. Plus Java className via
  `kind.includes('class')` matched `class_body` first, defeating the
  receiver tier completely. Plus Kotlin params via wrong field.

### Added — Resolver capabilities

- **Method-chain receiver inference** (`b51c283` + `b4d28a4` + `8b6a447`):
  `x.a().b()` propagates the inner call's return type as the outer's
  receiverType. Column convention shifted across 12 languages so chained
  calls have distinct location keys.
- **Inheritance-aware lookup** (`8d05c4d`): when `Foo.method` isn't directly
  indexed but `Foo extends Bar` and `Bar.method` exists, walk the hierarchy.
  8-deep BFS with cycle protection. Confidence 0.85.
- **Singleton/factory pattern propagation** (`a04487f`):
  `Foo.getInstance().method()` propagates the receiver type when the inner
  call's name matches a known factory (`getInstance`, `instance`, `default`,
  `shared`, `create`, `of`, `newInstance`).
- **Deferred-callee `@CALLEE:` marker** (`b0fc447`, `421dcad`, `b782bc4`,
  `0be7efd`): `const x = factory(); x.method()` resolves cross-file via the
  function's declared return type. Active in TS, Python, Kotlin, Java
  (`var`), C#, Scala.
- **Cross-file value bindings `@IMPORT:` marker** (`39313da`):
  `import { db } from './services'; db.query()` resolves via the source
  file's module-level bindings. New `globalValueBindings` map flows from
  per-file extractor output into the resolver context.
- **Static method detection** (`434508f`): PascalCase receiver with no
  scope-local binding is treated as a class reference. `Logger.warn`,
  `Math.sqrt`, `Console.WriteLine`. Active in 7 languages.
- **Type cast `as Foo`** (`1bcda3a`): the asserted type seeds the
  receiver-type binding. TS and Kotlin.

### Added — Per-language

- **Java** — Spring 4.3+ implicit ctor injection (`46ea2ae`); CDI / Jakarta
  EE / EJB / JAX-RS stereotypes (`@ApplicationScoped`, `@Stateless`, `@Path`,
  etc.) (`1e9bb8d`); bare typed fields enter `diMap` — catches Lombok
  `@RequiredArgsConstructor` (`1e9bb8d`); Maven multi-module test source
  roots + `<sourceDirectory>` overrides + per-repo memoization (`161402f`).
- **Kotlin** — extension functions `fun Foo.bar()` indexed as `Foo.bar`
  (`263c6c6`); noise list expanded to 32 entries (`d5a00aa`).
- **Python** — generic unwrap (`List[Foo]` / `Optional[Foo]` / `Dict[K,V]`)
  (`76a658e`); factory-method init (`__post_init__`, `setUp`, `asyncSetUp`)
  (`76a658e`); FastAPI `Depends()` resolution (`76a658e`); re-exports from
  `__init__.py` barrel files (`9fb99a3`).
- **TypeScript** — JSX/TSX components emit CALLS edges (`4b8131d`).
- **C/C++** — bespoke call-extraction walker (the shared `$CALLEE($$$ARGS)`
  ast-grep pattern returns zero matches for C/C++) (`4104401`); C++ promoted
  to full tier; out-of-class method definitions register className (`fe60a6b`,
  `596c58e`).
- **PHP** — custom call-site walk: laravel/framework went from 10 edges to
  160k+ (`aca8dd6`); receiver-type from typed properties + PHP 8 promoted
  ctor properties (`2e5124f`).
- **Rust** — promoted to full tier with 3-file fixture (`da463b5`).
- **9 langs** — typed function/method param bindings (TS, Kotlin, Go, Rust,
  C#, Scala, Swift, Dart, plus Java methods) (`61491c0`).

### Added — Documentation

- New `docs/SCHEMA.md`: full payload reference for every command.
- `README.md` Features / Schema / Confidence-levels sections refreshed.
- `docs/NEXT-STEPS.md` rewritten to reflect post-0.4.0 state.
- `docs/language-support-matrix.md` regenerated; 17 entries.

### Changed

- **Java promoted from `basic` to `full`** in support matrix.
- **`update.ts`** `tier_distribution` now reflects the merged graph (sum of
  edge tiers across old + new files), not just the re-parsed slice
  (`5bd1dd7`).
- **`context`** resolves slice calls against the full baseline graph (B8 fix
  in `70e177c`).
- Extractor registries unified behind `createLanguageRegistry<T>()` factory
  (`d5e7265`).
- Resolver tier pipeline restructured as declarative `TIERS = [receiver,
  noise, di, class, cascade]` array (`c65620c`).

### Fixed

Six latent extractor bugs that were silently producing wrong / empty data:

| Lang | Bug | Impact when fixed |
|---|---|---|
| **Java** | `className` via `kind.includes('class')` matched `class_body` BEFORE `class_declaration`. Every method indexed as top-level `file::method` instead of `file::Class.method`. Receiver tier silently failed for all methods. | Receiver hits on keycloak: 42 → 126729 (+301641%). Ambig: 0.745 → 0.430. |
| **Java** | `returnType` field is `type`, not `return_type`. Chain pass + deferred-callee couldn't propagate any Java return type. | Deferred-callee + chain receiver inference now functional. |
| **Kotlin** | `returnType` requires structural walk for the `user_type` after `:` token — tree-sitter doesn't expose `field('return_type')`. | Same as Java: enables chain + deferred-callee. |
| **C#** | `returnType` field is `returns`, not `return_type`. | Same. |
| **Go** | `returnType` field is `result`, not `return_type`. | Go chain pass + factory deferred now working. |
| **Kotlin** | `params` via `function_value_parameters` child, not `field('parameters')`. Every Kotlin function had `params: '()'`. | Contract diffs detect parameter changes; prompt format renders signatures correctly. |

Audit complete: TS, Python, Rust, PHP all use field accesses correctly;
Swift / Scala / Dart use custom helper functions. No further bugs in this
class.

### Schema

- New `EdgeTier` type: `'receiver' | 'di' | 'same' | 'import' | 'unique' |
  'ambiguous'`.
- `GraphEdge` gains optional `tier` field. Backward compatible.
- `RawGraph` gains `valueBindings: Map<file, Map<varName, type>>` for
  cross-file deferred resolution.
- `ExtractionResult` gains optional `valueBindings: ExtractedValueBinding[]`.
- Schema version remains **2.0** (no breaking changes; only optional
  additions).

### Validation results (real-repo)

| Repo | Language | Files | Status | Headline |
|---|---|---|---|---|
| sentry | Python | 14059 | 🟢 PASS | resolved 74.5%, ambig 27.4%, receiver 75.9/1k |
| **keycloak** | **Java** | **7657** | **🟢 PASS** | **resolved 94.3%, ambig 43.0%, receiver 1620/1k** (was GAP at 0.745) |
| kotlinx.coroutines | Kotlin | 1105 | 🟡 GAP | ambig 0.683 → 0.663 (-2pp). Lambda-receiver DSL needs stdlib indexing — out of scope. |

### Memory note

Parsing ~7k Java files with ~400k call sites requires `--max-memory 2048`
or higher. Default cap (768 MB) and validator-harness cap (1024 MB) OOM
the resolver phase on keycloak-scale repos.

---

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
