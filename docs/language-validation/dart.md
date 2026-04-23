# dart validation — 🟢 PASS

- repo: `/tmp/fase-d/dart`
- parse duration: 0.5s
- files_parsed: 104
- nodes / edges: 860 / 3233
- parse_errors: 0
- extract_errors: 0

## Verdict

Clears the full-tier bar. Candidate for promotion.

(no bar failures)

## Language breakdown (nodes by language)

dart: 860

## tier_distribution

| tier | count |
|---|---|
| receiver | 40 |
| di | 0 |
| same | 532 |
| import | 0 |
| unique | 586 |
| ambiguous | 1126 |
| noise | 31 |
| ambiguousNoise | 0 |

## Quality signals

- functions with complexity: **100.0%** (638 total)
- ambiguous edges with alternatives[]: **99.6%** (1107 ambiguous)
- high-confidence CALLS (0.9/0.95): **42** (25.0% of resolved)
- resolved ratio (resolved / total call sites): **98.7%**

## Proposed baselines (if promoting to full)

```typescript
baseline_tier_ratios: {
    resolved_min: 0.89,
    ambiguous_max: 0.50,
    receiver_min_per_1k_nodes: 44.5,
    di_min_per_1k_nodes: 0.0,
    high_conf_min_ratio: 0.20,
},
```
