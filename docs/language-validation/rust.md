# rust validation — 🟢 PASS

- repo: `/tmp/fase-d/rust`
- parse duration: 4.8s
- files_parsed: 776
- nodes / edges: 9872 / 23013
- parse_errors: 0
- extract_errors: 0

## Verdict

Clears the full-tier bar. Candidate for promotion.

(no bar failures)

## Language breakdown (nodes by language)

rust: 9872

## tier_distribution

| tier | count |
|---|---|
| receiver | 631 |
| di | 0 |
| same | 4207 |
| import | 0 |
| unique | 2395 |
| ambiguous | 7371 |
| noise | 3619 |
| ambiguousNoise | 2174 |

## Quality signals

- functions with complexity: **100.0%** (6929 total)
- ambiguous edges with alternatives[]: **98.8%** (7367 ambiguous)
- high-confidence CALLS (0.9/0.95): **631** (33.1% of resolved)
- resolved ratio (resolved / total call sites): **71.6%**

## Proposed baselines (if promoting to full)

```typescript
baseline_tier_ratios: {
    resolved_min: 0.62,
    ambiguous_max: 0.47,
    receiver_min_per_1k_nodes: 61.9,
    di_min_per_1k_nodes: 0.0,
    high_conf_min_ratio: 0.28,
},
```
