# CLI flow validation: django

- repo: `https://github.com/django/django`
- language: python
- target file (for analyze/context/diff): `tests/generic_views/test_list.py`
- max-memory: 2048 MB
- timestamp: 2026-05-04T18:15:30Z

## Parse result

- files_parsed: 943
- total_nodes: 58446
- total_edges: 160764
- tier_distribution: receiver=1512 di=0 same=15755 import=16259 unique=23021 ambig=45153 noise=203

## CLI command results

| Command | Exit | Duration (s) | Output bytes | Warnings/Errors |
|---|---|---|---|---|
| parse | 0 | 22 | 110344929 | 3 |
| analyze | 0 | 1 | 5800 | 1 |
| context_prompt | 0 | 6 | 384 | 1 |
| context_json | 0 | 6 | 139629389 | 1 |
| diff | 0 | 0 | 20297 | 1 |
| search | 0 | 0 | 22495 | 0 |
| communities | 0 | 22 | 457884 | 0 |
| flows | 0 | 1 | 78338792 | 0 |
| update | 0 | 1 | 123242366 | 5 |

## Notes

- **parse**: [WARN] No import resolver registered for language {"lang":"JavaScript","module":"./module_test.js","from":"/tmp/kodus-graph-cli-flow/django/tests/staticfiles_tests/project/documents/cached/module.js"}
- **analyze**: [WARN] Memory pressure detected, reducing batch size {"rssMB":990,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **diff**: [WARN] Memory pressure detected, reducing batch size {"rssMB":760,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **update**: [WARN] Memory pressure detected, reducing batch size {"rssMB":1015,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
