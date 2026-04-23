# php validation — 🟡 GAP

- repo: `/tmp/fase-d/php`
- parse duration: 14.4s
- files_parsed: 2883
- nodes / edges: 46982 / 160384
- parse_errors: 0
- extract_errors: 0

## Verdict

Does NOT clear the full-tier bar. See failures below.

### Bar failures

- receiver+di per-1k both < 1

## Language breakdown (nodes by language)

php: 46980, JavaScript: 2

## tier_distribution

| tier | count |
|---|---|
| receiver | 0 |
| di | 0 |
| same | 18277 |
| import | 7958 |
| unique | 25902 |
| ambiguous | 65979 |
| noise | 3287 |
| ambiguousNoise | 4503 |

## Quality signals

- functions with complexity: **100.0%** (28148 total)
- ambiguous edges with alternatives[]: **100.0%** (64456 ambiguous)
- high-confidence CALLS (0.9/0.95): **13344** (15.5% of resolved)
- resolved ratio (resolved / total call sites): **93.8%**

## Proposed baselines (if promoting to full)

(skipped — does not clear bar)

## History

- 2026-04-20: 🟡 GAP — only 10 edges / 28508 functions. Root cause: the
  shared `$CALLEE($$$ARGS)` pattern matches 0 calls against PHP's
  tree-sitter grammar (grammar uses 3 distinct kinds:
  `function_call_expression`, `member_call_expression`,
  `scoped_call_expression`).
- 2026-04-23: bug fix — custom walk of PHP-specific call kinds.
  Edges **10 → 160,384** (16000x). Resolved ratio **80% → 93.8%**.
  HighConf CALLS **0 → 13,344** (15.5%).
- Remaining gap: `receiver + di per-1k < 1`. PHP has
  `receiver_type: 'none'` by design — variables are dynamically typed.
  Reliable receiver-type inference would require parsing PHPDoc `@var`
  hints + constructor/property type declarations. Deferred as future
  work.
