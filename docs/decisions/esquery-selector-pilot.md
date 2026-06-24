# Decision: ESQuery-style selectors — pilot result (do NOT adopt broadly)

**Date:** 2026-06-24 · **Status:** Decided — not adopting · **Context:** napi 0.44

## Background

`@ast-grep/napi` 0.43+ added ESQuery-style structural selectors (`A > B`,
`A B`, `:has`, `:not`, `:is`, `:nth-child`) usable in the JS rule API's `kind`
field, e.g. `findAll({ rule: { kind: 'class_heritage > extends_clause' } })`.
The extractors are dominated by manual direct-children walks
(`node.children().find(c => c.kind() === 'X')`). The question: replace those
with ESQuery selectors for clarity?

This was the "Phase 4 / ESQuery pilot" item — explicitly gated on measuring
before adopting.

## What the pilot found (empirical, napi 0.44)

1. **The selectors work in the JS API.** `>`, descendant, `:has`, `:not`, and
   `:is(a, b, c)` OR-grouping all evaluate correctly via `find`/`findAll`.

2. **Descendant semantics over-match — a correctness hazard.** `find`/`findAll`
   search ALL descendants of the scope node, not direct children. Probing
   `class Outer extends A { m() { class Inner extends B {} } }`:

   ```
   outer.findAll({ rule: { kind: 'extends_clause' } })  →  ["extends A", "extends B"]
   ```

   The manual `node.children().find(c => c.kind() === 'class_heritage')` returns
   only the outer class's heritage. The ESQuery selector cannot anchor a node as
   a *direct child of the scope node* (the `>` combinator only relates kinds to
   each other, not to the query root), so a scoped `find` either over-matches
   (`findAll`) or relies on document order (`find` returns the first match) —
   fragile. For heritage / parameter / member walks, the explicit direct-child
   walk is the safer, clearer expression of intent.

3. **No performance benefit.** Benchmarking the TS heritage extraction over 120
   of this repo's `.ts` files (×30): manual `196 ms` vs ESQuery `211 ms` —
   ESQuery is ~**1.1× (10% slower)**. The manual walk wins marginally.

## Decision

**Do not migrate the existing direct-children walks to ESQuery selectors.**

- Clarity is a wash (the walks are already centralized behind typed `kinds.ts`).
- Correctness favors the walks (no nested-declaration over-match).
- Performance favors the walks (slightly).

## When ESQuery selectors ARE worth reaching for

Keep them in the toolbox for **new** queries where:

- descendant/`:has`/`:not` semantics are genuinely what you want (e.g. "find
  every class that contains a `try` statement"), and
- the equivalent manual walk would be deep/awkward, and
- over-matching nested nodes is acceptable or impossible in that context.

The 0.44 base is in place, so this is available without further upgrade.
