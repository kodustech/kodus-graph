# CLI flow validation: rails

- repo: `https://github.com/rails/rails`
- language: ruby
- target file (for analyze/context/diff): `actionpack/test/abstract/translation_test.rb`
- max-memory: 2048 MB
- timestamp: 2026-05-04T18:16:10Z

## Parse result

- files_parsed: 146
- total_nodes: 51363
- total_edges: 177766
- tier_distribution: receiver=81 di=0 same=17178 import=18 unique=24567 ambig=83791 noise=58

## CLI command results

| Command | Exit | Duration (s) | Output bytes | Warnings/Errors |
|---|---|---|---|---|
| parse | 0 | 18 | 175629356 | 1 |
| analyze | 0 | 0 | 5919 | 1 |
| context_prompt | 0 | 1 | 159 | 1 |
| context_json | 0 | 1 | 211324225 | 1 |
| diff | 0 | 1 | 10003 | 1 |
| search | 0 | 1 | 25123 | 0 |
| communities | 0 | 5 | 265460 | 0 |
| flows | 0 | 1 | 5483471 | 0 |
| update | 0 | 1 | 195779550 | 5 |

## Notes

- **parse**: [WARN] No import resolver registered for language {"lang":"JavaScript","module":"./index","from":"/tmp/kodus-graph-cli-flow/rails/actioncable/app/javascript/action_cable/index_with_name_deprecation.js
- **analyze**: [WARN] Memory pressure detected, reducing batch size {"rssMB":1331,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **diff**: [WARN] Memory pressure detected, reducing batch size {"rssMB":1322,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **update**: [WARN] Memory pressure detected, reducing batch size {"rssMB":1349,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
