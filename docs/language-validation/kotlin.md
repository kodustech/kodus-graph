# kotlin validation — 🟡 GAP

- repo: `/tmp/fase-d/kotlin`
- parse duration: 4.4s
- files_parsed: 1105
- nodes / edges: 13115 / 33163
- parse_errors: 0
- extract_errors: 0

## Verdict

Does NOT clear the full-tier bar. See failures below.

### Bar failures

- ambigRatio 0.683 > 0.6

## Language breakdown (nodes by language)

kotlin: 13068, java: 44, python: 3

## tier_distribution

| tier | count |
|---|---|
| receiver | 618 |
| di | 0 |
| same | 4021 |
| import | 2 |
| unique | 3253 |
| ambiguous | 17046 |
| noise | 1030 |
| ambiguousNoise | 1518 |

## Quality signals

- functions with complexity: **100.0%** (7267 total)
- ambiguous edges with alternatives[]: **95.3%** (16701 ambiguous)
- high-confidence CALLS (0.9/0.95): **618** (18.6% of resolved)
- resolved ratio (resolved / total call sites): **90.7%**

## Proposed baselines (if promoting to full)

(skipped — does not clear bar)
