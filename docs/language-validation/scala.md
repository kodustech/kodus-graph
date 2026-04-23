# scala validation — 🟢 PASS

- repo: `/tmp/fase-d/scala`
- parse duration: 3.9s
- files_parsed: 2368
- nodes / edges: 17171 / 37622
- parse_errors: 0
- extract_errors: 0

## Verdict

Clears the full-tier bar. Candidate for promotion.

(no bar failures)

## Language breakdown (nodes by language)

scala: 14460, java: 1685, kotlin: 507, TypeScript: 244, python: 202, JavaScript: 37, Tsx: 29, c: 6, cpp: 1

## tier_distribution

| tier | count |
|---|---|
| receiver | 265 |
| di | 0 |
| same | 7853 |
| import | 220 |
| unique | 5852 |
| ambiguous | 11658 |
| noise | 5680 |
| ambiguousNoise | 2561 |

## Quality signals

- functions with complexity: **100.0%** (10039 total)
- ambiguous edges with alternatives[]: **97.4%** (9562 ambiguous)
- high-confidence CALLS (0.9/0.95): **165** (31.4% of resolved)
- resolved ratio (resolved / total call sites): **75.8%**

## Proposed baselines (if promoting to full)

```typescript
baseline_tier_ratios: {
    resolved_min: 0.66,
    ambiguous_max: 0.46,
    receiver_min_per_1k_nodes: 13.4,
    di_min_per_1k_nodes: 0.0,
    high_conf_min_ratio: 0.26,
},
```
