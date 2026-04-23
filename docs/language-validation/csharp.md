# csharp validation — 🟢 PASS

- repo: `/tmp/fase-d/csharp`
- parse duration: 1.3s
- files_parsed: 214
- nodes / edges: 2229 / 3923
- parse_errors: 0
- extract_errors: 0

## Verdict

Clears the full-tier bar. Candidate for promotion.

(no bar failures)

## Language breakdown (nodes by language)

csharp: 2229

## tier_distribution

| tier | count |
|---|---|
| receiver | 176 |
| di | 0 |
| same | 426 |
| import | 0 |
| unique | 454 |
| ambiguous | 949 |
| noise | 601 |
| ambiguousNoise | 23 |

## Quality signals

- functions with complexity: **100.0%** (1389 total)
- ambiguous edges with alternatives[]: **86.6%** (940 ambiguous)
- high-confidence CALLS (0.9/0.95): **176** (30.0% of resolved)
- resolved ratio (resolved / total call sites): **76.3%**

## Proposed baselines (if promoting to full)

```typescript
baseline_tier_ratios: {
    resolved_min: 0.66,
    ambiguous_max: 0.39,
    receiver_min_per_1k_nodes: 77.0,
    di_min_per_1k_nodes: 0.0,
    high_conf_min_ratio: 0.25,
},
```
