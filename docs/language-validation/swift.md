# swift validation — 🟢 PASS

- repo: `/tmp/fase-d/swift`
- parse duration: 12.2s
- files_parsed: 1683
- nodes / edges: 15505 / 97306
- parse_errors: 0
- extract_errors: 0

## Verdict

Clears the full-tier bar. Candidate for promotion.

(no bar failures)

## Language breakdown (nodes by language)

swift: 15434, c: 63, python: 7, cpp: 1

## tier_distribution

| tier | count |
|---|---|
| receiver | 3750 |
| di | 0 |
| same | 8282 |
| import | 948 |
| unique | 30611 |
| ambiguous | 42877 |
| noise | 1282 |
| ambiguousNoise | 5476 |

## Quality signals

- functions with complexity: **100.0%** (7498 total)
- ambiguous edges with alternatives[]: **77.5%** (40844 ambiguous)
- high-confidence CALLS (0.9/0.95): **5237** (13.9% of resolved)
- resolved ratio (resolved / total call sites): **92.8%**

## Proposed baselines (if promoting to full)

```typescript
baseline_tier_ratios: {
    resolved_min: 0.83,
    ambiguous_max: 0.59,
    receiver_min_per_1k_nodes: 239.9,
    di_min_per_1k_nodes: 0.0,
    high_conf_min_ratio: 0.09,
},
```
