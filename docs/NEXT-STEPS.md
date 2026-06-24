# Next Steps

State snapshot **2026-06-24** (v0.5.0): merged to `main`, **1218 tests passing**,
`@ast-grep/napi` 0.44, test gate stable (the fs-timeout flake is fixed). The
"grammar-drift guard" release shipped: 14 per-language `kinds.ts` modules +
sanity tests, dead cross-language code removed, the `outline` command (with
cross-file CALLS/blast-radius enrichment), a ~20% receiver-type speedup, and a
single-package-manager (Bun) toolchain. See `CHANGELOG.md` `[0.5.0]` for the
full list.

This document tracks what remains within (and beyond) the syntactic ast-grep +
tree-sitter approach. The "Remaining work" and "Priority sequence" sections
below are the live roadmap; the "Shipped" / "Real-repo validation" sections are
the historical record from the v0.4.0 session.

---

## Shipped (v0.4.0 session — historical)

### Architectural / refactor
- Consolidated extension-to-language mapping under `src/languages/language-of-file.ts` (`a08c8de`)
- Generic `createLanguageRegistry<T>()` factory unifying 5 parallel registries (`d5e7265`)
- Declarative tier pipeline in `call-resolver.ts` — TIERS array (`c65620c`)
- `tier` field persisted on every CALLS edge; `update.ts` recomputes `tier_distribution` from merged graph (`5bd1dd7`)
- B8 fixed: `context` now resolves slice calls against the full baseline graph (`70e177c`)
- Property-based tests (fast-check) for pure resolver utilities (`ea87dea`)

### Resolver features
- Method-chain receiver inference `x.a().b()` — column convention shifted across 12 langs (`8b6a447` + `b4d28a4` + `b51c283`)
- Inheritance-aware lookup: extends + implements + cycle protection at depth ≤ 8 (`8d05c4d`)
- Singleton / factory pattern propagation in chain pass: `Foo.getInstance().method()` (`a04487f`)
- Deferred-callee `@CALLEE:funcName` cross-file marker, resolved against global return-types map (TS, Python, Kotlin) (`b0fc447` + `421dcad`)

### Per-language additions
- **Java**: Spring 4.3+ implicit ctor injection + ctor-param receiver-type (`46ea2ae`)
- **Java**: CDI / Jakarta / EJB / JAX-RS stereotypes + bare typed fields as DI bindings (`1e9bb8d`)
- **Java**: Maven multi-module — test source roots + `<sourceDirectory>` overrides + per-repo memoization (`161402f`)
- **Kotlin**: noise list expanded (preconditions, builders, stdlib helpers) (`d5a00aa`)
- **Kotlin**: extension functions `fun Foo.bar()` indexed as methods on receiver type (`263c6c6`)
- **Kotlin**: structural fix for `field('return_type')` — tree-sitter doesn't expose it (in `421dcad`)
- **Python**: generic unwrap, factory-method init, FastAPI Depends (`76a658e`)
- **PHP**: receiver-type via typed properties + scope-local bindings (`2e5124f`)
- **C/C++**: bespoke call-extraction walker (the shared `$CALLEE($$$ARGS)` pattern returns zero matches) (`4104401`)
- **9 langs**: typed function/method param bindings (TS, Kotlin, Go, Rust, C#, Scala, Swift, Dart, Java methods) (`61491c0`)
- **7 langs**: PascalCase static method detection (`Logger.warn(...)`) (`434508f`)
- **TypeScript**: JSX/TSX components emit CALLS edges (`4b8131d`)
- **TypeScript / Kotlin**: type cast `as Foo` seeds receiver-type bindings (`1bcda3a`)

### Documentation
- Validation reports for sentry, keycloak, kotlinx.coroutines (`cfaab72`)
- Support matrix updated with current real-repo status per language
- README features section, schema reference, confidence levels table refreshed (this commit)

---

## Real-repo validation (2026-04-30 — v0.4.0 session, historical)

Three repos representing different language ecosystems were re-validated after this session's work:

| Repo | Language | Status | Headline metric |
|---|---|---|---|
| **sentry-greptile-test** | Python (14059 files) | 🟢 PASS | resolved 74.5% / ambig 27.4% / receiver 75.9 per 1k / high_conf 16.8% |
| **keycloak-greptile-test** | Java (7657 files) | 🟡 GAP | DI hits 3 → **444 (+148×)**; ambig 0.745 → 0.741 |
| **kotlinx.coroutines** | Kotlin (1105 files) | 🟡 GAP | receiver hits 1061 → **1494 (+40%)**; ambig 0.683 → 0.663 (-2pp) |

Notes:

- **Python clears the full-tier bar comprehensively.** Typed-param + static + deferred-callee + factory-init combine well for the Python ecosystem.
- **Keycloak has a DI breakthrough** — bare typed fields + CDI/EJB stereotypes turn 3 hits into 444 — but ambiguous ratio dropped only 0.4pp because the codebase is dominated by calls into framework types (HttpServletRequest, KeycloakSession, Realm) that aren't in the user symbol table.
- **Kotlinx still GAP** because the codebase is dominated by lambda-receiver DSL (`launch { delay(1000) }`) where the implicit `this` is the coroutine scope. Solving that requires lambda-receiver inference — out of scope for a syntactic approach.
- **Memory:** keycloak-scale parses (7k files, ~400k call sites) need `--max-memory 2048`. The validator harness's 1GB cap OOMs the resolver phase. Library users hitting this should bump the cap.

Reports archived in `docs/language-validation/` (sentry, kotlinx-rerun, keycloak-rerun, keycloak-after).

---

## Immediate next actions (v0.4.0 session — historical, done)

### 1. Push to origin

```bash
git push origin main
```

32 commits sitting locally is unnecessary risk. Before pushing, decide:

- **Version bump**: `package.json` is at `0.3.0`. The schema added a `tier` field on `GraphEdge` (optional for backward compat with pre-2026-04 graphs). Bumping to `0.4.0` documents that consumers can opt into reading `edge.tier`. CI doesn't auto-publish to npm — release notes can be drafted manually from the commit log.
- **Changelog**: no `CHANGELOG.md` today. The 32 commits between `origin/main` and HEAD are well-scoped — `git log --oneline origin/main..HEAD` gives a reasonable starting point.

### 2. Communicate the schema bump

Consumers reading `parse-output.json` will see a new optional `tier` field on every CALLS edge. This is informational (no parser breakage), but downstream tooling that asserts schema can opt to consume it for richer trust calibration.

---

## Remaining work (organized by feasibility)

### Achievable within ast-grep + tree-sitter only (cross-file aggregation refactor)

These are still purely syntactic; they require building global maps from per-file extractor output and threading them into the resolver. None of them needs DFA, alias analysis, or external symbol info.

- **Cross-file value bindings (TS/Python).** `export const db = new Database(); ... import { db }; db.query()` — currently `db` has no `receiverType` in the consumer file. Mechanism: per-file extractor exposes value-bindings map; engine aggregates into `globalValueBindings: Map<file, Map<varName, type>>`; resolver checks it when receiver is an imported name. Same shape as the existing `@CALLEE:` deferred mechanism. Estimated: 4–6h.
- **Field-of-field chains.** `this.config.db.connect()` (n-hop > 1). Mechanism: per-class field-type map exposed globally, resolver walks the chain consulting it. Estimated: 4h.
- **Per-class diMap scoping (Java).** Today `diMap` is per-FILE. When two classes in the same file share a field name with different types, last write wins. Refactoring to per-class scope removes the rare collision. Estimated: 2h.

### Speculative but doable

- **Lambda-receiver DSL (Kotlin).** `launch { delay(1000) }` requires reading `launch`'s signature to extract the lambda's receiver type. The signature lives in kotlinx stdlib, *outside* the user repo. Without indexing dependencies, this can only resolve when the receiver-type-providing function is defined in the user code. Partial solution: catalog of common Kotlin DSL builders (kotlinx coroutines, Compose, Spring) with hard-coded receiver types. Maintenance cost.
- **Builder pattern detection.** `Foo.builder().setX().setY().build()` — propagate `Foo$Builder` through chained setX/setY calls. Risk: false positives on non-builder methods named like setters.

### Out of scope (would need symbol info from outside)

- **Framework-type calls (Java/Kotlin/Spring).** `request.getHeader()` resolves only if HttpServletRequest is in the user's symbol table. To resolve calls into JDK / framework types, we'd need to index `*.jar` files or stdlib `.kt` source — invasive and heavy.
- **Generic instantiation.** `Map<string, User>` — currently only the head identifier is captured. Real generic inference would need type unification, out of scope.
- **Flow analysis.** `if (cond) x = A() else x = B(); x.method()` resolves to whichever assignment came last, not a union. Requires SSA form / control-flow modeling.

---

## Documentation gaps to close

These are the places where the docs lag behind the code:

- ✅ `docs/language-support-matrix.md` — auto-generated; current after `bun run docs:matrix`.
- ✅ `README.md` Features + Schema + Confidence — refreshed this commit.
- ⏳ `docs/SCHEMA.md` — full payload reference (input/output for every command). Not present today; consumers rely on TypeScript interfaces in `src/graph/types.ts`.
- ✅ `CHANGELOG.md` — created; `[0.5.0]` documents this release (Keep a Changelog format).
- ⏳ Cookbook / recipes — "how to read tier_distribution", "how to filter by confidence", "how to detect blast radius hotspots". Currently scattered across README sections.

---

## Priority sequence (from v0.5.0)

1. **Publish v0.5.0.** `main` is at 0.5.0 with the CHANGELOG, but npm still shows
   an older release — close the publish gap so the `outline` command and the
   grammar-drift guards are actually consumable.
2. **Per-class diMap scoping (Java)** — the cheapest remaining resolver win
   (~2h, listed under "Remaining work"); removes the same-file field-name
   collision.
3. **Verify, then maybe do, cross-file value bindings (TS/Python).** The
   `@IMPORT:` / `valueBindings` deferred mechanism already exists — confirm how
   much of the "Remaining work" item is already shipped before planning it.
4. **ESQuery-selector pilot.** napi 0.44 unlocks `kind: 'export_statement >
   function_declaration'`, `:has`, `:not`, `:is`, `:nth-child` in the JS rule
   API. Pilot on 1–2 verbose extractors (TS heritage, Java DI) and **measure**
   clarity vs. performance before adopting — manual walks are sometimes faster.
5. **Field-of-field chains** (`this.config.db.connect()`, ~4h) — once the above
   land and real-repo data says it's worth it.
6. **Run on a fresh production repo** and compare `tier_distribution` / ambig
   ratio against v0.4.x. Let real LLM-review usage, not speculation, pick the
   next resolver investment.

Don't rush 6. A week of real use beats a week of speculation.
