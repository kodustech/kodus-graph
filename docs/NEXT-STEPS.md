# Next Steps

State snapshot: **26 commits ahead of `origin/main`**, 1016 tests passing, 0 warnings, schema v2.0 enforced.

Work completed in this cycle closed every item from the original hardcode-elimination roadmap plus unplanned user-reported bugs (whitespace FPs, mini-diff rendering, ReviewFocus dedup) and P0 resolver consistency.

---

## Immediate (do these before more code)

### 1. Push to origin

```bash
git push origin main
```

26 local commits sitting on one machine is unnecessary risk. Before pushing, decide:
- **Version bump.** `package.json` is at `0.2.19`. `SCHEMA_VERSION` bumped `1.0 → 2.0` (value-level breaking for graph consumers — `GraphNode.language` keys normalized). Conservative: bump `0.3.0` (minor with schema break). If CI publishes to npm automatically, write release notes first.
- **CHANGELOG.** Don't exist today. If publishing publicly, generate one from the commit log between `523538d` (last pre-session) and `6669155` (current HEAD).

### 2. Validate on a real codebase (1-2h)

Run the full pipeline against `kodus-web` (or any production repo) and compare against a pre-session run. Focus areas:

| Check | How |
|---|---|
| `changedFunctions` count dropped | Parse + context on same PR pre/post — expect drop proportional to whitespace-FPs the team generates |
| `Alternatives considered:` renders cleanly | Inspect a prompt with a known ambiguous call |
| Capabilities suppression fires for Go | Find a Go PR, confirm no `is_async` lines in prompt |
| Receiver-tier 0.95 edges appear | Python/Java/Kotlin repos — verify `x.method()` resolves when `x: Foo` is inferable |
| `tier_distribution` shape matches repo | TS repo should skew `receiver`/`di`/`same`/`import`; Python repo skews higher `ambiguous`/`noise` |
| Mini-diff renders for long params | Find a PR with a large type change, confirm `+ field` vs blob |

Document surprises. Real-world output reveals cases the test suite doesn't.

---

## Next work (only with evidence)

### If validation surfaces new false positives

The resolver order + normalization got close but not perfect. Likely next classes to investigate:
- Method-chain calls: `x.a().b().c()` — does each link get a receiver type? (Today probably only the first.)
- Generic instantiation: `const x = new Map<string, User>()` — does receiver type capture `Map` or `Map<string, User>`?
- Destructuring imports: `const { service } = deps` — no receiver-type extracted.

### If you hit perf ceiling on monorepos

**P1 #3: Unify AST walks.** Today each language file is walked 3 times (`extract`, `extractCalls`, `extractReceiverTypes`). One merged traversal per file is 3x faster. Requires redesigning the `LanguageExtractors` contract (breaking for any external consumer of that interface). Medium-scope refactor; 14 extractors need coordinated update.

### If you have a backlog of new fields to add

**P1 #4: `buildExtractedFunction` helper per language.** Each `extractor.ts` has 5-6 sites constructing `ExtractedFunction` (function declarations, methods, arrows, constructors, generators, etc). Adding a new field (e.g. `visibility: 'public'|'private'`) today = ~80 touchpoints (14 languages × 5-6 sites). With the helper = ~14 touchpoints (one per language). Pays off only when 2+ new fields are on the roadmap.

### Feature ideas ready to plan

- **Python deep receiver-type inference.** Today covers constructor + type hints. Flow analysis (`x = factory()` where `factory` return type is known) would close the remaining gap for Python. Requires walking call graph + return type inference.
- **LSP-assisted resolution tier.** Fetch types from `tsserver` / `pyright` / `gopls` on demand, use them to replace proximity-based ambiguous tier with authoritative type resolution. Highest signal gain; multi-month scope.
- **Incremental `tier_distribution` merge.** Today `update.ts` emits a slice (changed-file stats only). Consumers wanting full-repo picture must re-run `parse --all`. Merge the slice with the baseline graph's prior distribution to avoid that. Small utility.
- **Receiver-type inference across method chains.** `x.a().b()` — today `x.a()` gets type via receiver inference, `.b()` doesn't because the intermediate value has no binding. Track return types of resolved calls → use as receiver for chained call. Closes a real gap.

---

## Open tech debt (P2/P3 from senior review)

Not blocking, low individual ROI. Paydown these only when touching the area for another reason:

- **`createLanguageRegistry<T>()` factory** — 4 parallel registries today (extractor, noise, DI, capabilities, receiver-types). All share the same shape. A 5th would doubly justify the factory.
- **Declarative tier pipeline in `call-resolver.ts`** — main loop is a chain of `if/continue`. Each new tier is invasive. `TIERS = [receiver, noise, di, class, cascade]; for (tier of TIERS) ...` would be cleaner and document the order explicitly.
- **Property-based tests** for `pickClosestCandidate`, `tokenizeTopLevel`, `normalizeParams` — pure functions with regular input. Would catch Unicode / Windows-path / edge-char bugs.
- **Capabilities matrix in AGENTS.md** — a 14-row × 5-column table showing per-language declarations. Discoverability win, zero runtime impact.
- **Consolidate `language-of-file.ts` vs `src/parser/languages.ts`** — two sources of truth for extension → language mapping. Low-risk dedup.
- **Test helper for `SymbolTable`** — every resolver test does `new SymbolTable(); table.register(...); table.register(...)`. A `buildSymbolTable([...])` factory would tighten setup.
- **`update.ts` tier_distribution semantics** — "slice" model works but consumers may expect merged. Document more explicitly OR offer both modes via flag.

---

## What NOT to do

- **Don't keep refactoring internal structure without validating.** We've done heavy lifting (per-language registries, canonical keys, loader enforcement, tier reorder). Another internal refactor without production evidence is overengineering.
- **Don't add new features before pushing + running on real code.** Features on top of unvalidated foundation compound risk.
- **Don't unify AST walks just because perf concern.** Unless real monorepo shows a problem, the 3-walk cost is paid-for-correctness separation. Architectural "god method" is a real regression.

---

## Priority order if you want a prescribed sequence

1. Push `main` to `origin` (30 min, decide version bump)
2. Run on a real PR in `kodus-web` (1-2h), document wins/surprises
3. Sit with it for a week while reviewing PRs — observe LLM reviewer quality
4. Come back with data — decide between feature work (receiver chains, LSP tier) vs dívida estrutural vs more polish

Don't rush 3. A week of real use beats a week of speculation.
