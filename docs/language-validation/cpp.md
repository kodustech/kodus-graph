# cpp validation — 🟢 PASS

- repo: `/tmp/fase-d/cpp`
- parse duration: 13.8s
- files_parsed: 1322
- nodes / edges: 30509 / 82129
- parse_errors: 0
- extract_errors: 0

## Verdict

Clears the full-tier bar. Candidate for promotion.

(no bar failures)

## Language breakdown (nodes by language)

rust: 4166, swift: 3147, python: 2914, JavaScript: 2802, c: 2768, cpp: 2723, java: 2666, kotlin: 2049, csharp: 1874, dart: 1874, TypeScript: 1805, go: 1096, php: 625

## tier_distribution

| tier | count |
|---|---|
| receiver | 3082 |
| di | 5 |
| same | 16652 |
| import | 422 |
| unique | 10053 |
| ambiguous | 27472 |
| noise | 2886 |
| ambiguousNoise | 4534 |

## Quality signals

- functions with complexity: **100.0%** (23983 total)
- ambiguous edges with alternatives[]: **93.3%** (25753 ambiguous)
- high-confidence CALLS (0.9/0.95): **4147** (34.2% of resolved)
- resolved ratio (resolved / total call sites): **88.6%**

## Proposed baselines (if promoting to full)

```typescript
baseline_tier_ratios: {
    resolved_min: 0.79,
    ambiguous_max: 0.48,
    receiver_min_per_1k_nodes: 99.0,
    di_min_per_1k_nodes: 0.0,
    high_conf_min_ratio: 0.29,
},
```
