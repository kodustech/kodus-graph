# CLI flow validation: ktor

- repo: `https://github.com/ktorio/ktor`
- language: kotlin
- target file (for analyze/context/diff): `ktor-test-server/src/main/kotlin/test/server/TestServer.kt`
- max-memory: 2048 MB
- timestamp: 2026-05-04T18:14:09Z

## Parse result

- files_parsed: 242
- total_nodes: 21399
- total_edges: 61574
- tier_distribution: receiver=3489 di=0 same=7015 import=1 unique=8715 ambig=25023 noise=23

## CLI command results

| Command | Exit | Duration (s) | Output bytes | Warnings/Errors |
|---|---|---|---|---|
| parse | 0 | 10 | 69556017 | 0 |
| analyze | 0 | 0 | 1292 | 1 |
| context_prompt | 0 | 1 | 64 | 1 |
| context_json | 0 | 2 | 81038986 | 1 |
| diff | 0 | 1 | 3881 | 0 |
| search | 0 | 0 | 31400 | 0 |
| communities | 0 | 4 | 368656 | 0 |
| flows | 0 | 1 | 43929555 | 0 |
| update | 0 | 1 | 74819656 | 1 |

## Notes

- **analyze**: [WARN] Memory pressure detected, reducing batch size {"rssMB":547,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **update**: [WARN] Memory pressure detected, reducing batch size {"rssMB":553,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
