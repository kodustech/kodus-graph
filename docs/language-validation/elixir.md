# elixir validation — 🟢 PASS

- repo: `/tmp/fase-d/elixir`
- parse duration: 1.5s
- files_parsed: 201
- nodes / edges: 5279 / 14938
- parse_errors: 0
- extract_errors: 0

## Verdict

Clears the full-tier bar. Candidate for promotion.

(no bar failures)

## Language breakdown (nodes by language)

elixir: 4318, JavaScript: 961

## tier_distribution

| tier | count |
|---|---|
| receiver | 75 |
| di | 0 |
| same | 3830 |
| import | 417 |
| unique | 1387 |
| ambiguous | 5653 |
| noise | 2385 |
| ambiguousNoise | 475 |

## Quality signals

- functions with complexity: **100.0%** (3665 total)
- ambiguous edges with alternatives[]: **84.8%** (5274 ambiguous)
- high-confidence CALLS (0.9/0.95): **249** (34.4% of resolved)
- resolved ratio (resolved / total call sites): **79.9%**

## Proposed baselines (if promoting to full)

```typescript
baseline_tier_ratios: {
    resolved_min: 0.70,
    ambiguous_max: 0.53,
    receiver_min_per_1k_nodes: 12.2,
    di_min_per_1k_nodes: 0.0,
    high_conf_min_ratio: 0.29,
},
```
