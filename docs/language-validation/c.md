# c validation — 🟡 GAP

- repo: `/tmp/fase-d/c`
- parse duration: 5.8s
- files_parsed: 811
- nodes / edges: 11987 / 13590
- parse_errors: 0
- extract_errors: 0

## Verdict

Does NOT clear the full-tier bar. See failures below.

### Bar failures

- receiver+di per-1k both < 1

## Language breakdown (nodes by language)

c: 11678, python: 272, ruby: 18, cpp: 18, JavaScript: 1

## tier_distribution

| tier | count |
|---|---|
| receiver | 0 |
| di | 0 |
| same | 340 |
| import | 99 |
| unique | 52 |
| ambiguous | 58 |
| noise | 792 |
| ambiguousNoise | 3 |

## Quality signals

- functions with complexity: **100.0%** (10684 total)
- ambiguous edges with alternatives[]: **93.6%** (47 ambiguous)
- high-confidence CALLS (0.9/0.95): **169** (61.9% of resolved)
- resolved ratio (resolved / total call sites): **40.8%**

## Proposed baselines (if promoting to full)

(skipped — does not clear bar)
