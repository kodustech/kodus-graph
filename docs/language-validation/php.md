# php validation — 🟡 GAP

- repo: `/tmp/fase-d/php`
- parse duration: 10.9s
- files_parsed: 2883
- nodes / edges: 47367 / 44578
- parse_errors: 0
- extract_errors: 0

## Verdict

Does NOT clear the full-tier bar. See failures below.

### Bar failures

- receiver+di per-1k both < 1
- highConfRatio 0.000 < 0.1

## Language breakdown (nodes by language)

php: 47365, JavaScript: 2

## tier_distribution

| tier | count |
|---|---|
| receiver | 0 |
| di | 0 |
| same | 0 |
| import | 5 |
| unique | 0 |
| ambiguous | 3 |
| noise | 2 |
| ambiguousNoise | 0 |

## Quality signals

- functions with complexity: **100.0%** (28508 total)
- ambiguous edges with alternatives[]: **100.0%** (1 ambiguous)
- high-confidence CALLS (0.9/0.95): **0** (0.0% of resolved)
- resolved ratio (resolved / total call sites): **80.0%**

## Proposed baselines (if promoting to full)

(skipped — does not clear bar)
