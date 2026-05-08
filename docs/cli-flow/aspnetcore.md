# CLI flow validation: aspnetcore

- repo: `https://github.com/dotnet/aspnetcore`
- language: csharp
- target file (for analyze/context/diff): `eng/tools/HelixTestRunner/HelixTestRunnerOptions.cs`
- max-memory: 4096 MB
- timestamp: 2026-05-04T18:22:30Z

## Parse result

- files_parsed: 315
- total_nodes: 115934
- total_edges: 403122
- tier_distribution: receiver=97984 di=114 same=49972 import=829 unique=28534 ambig=130605 noise=89

## CLI command results

| Command | Exit | Duration (s) | Output bytes | Warnings/Errors |
|---|---|---|---|---|
| parse | 0 | 164 | 692154387 | 27 |
| analyze | 0 | 3 | 1170 | 1 |
| context_prompt | 0 | 76 | 101 | 1 |
| context_json | 0 | 71 | 796366674 | 1 |
| diff | 0 | 2 | 1242 | 1 |
| search | 0 | 1 | 28109 | 0 |
| communities | 0 | 18 | 904530 | 0 |
| flows | 0 | 5 | 502759683 | 0 |
| update | 0 | 11 | 756503084 | 5 |

## Notes

- **parse**: [WARN] Memory pressure detected, reducing batch size {"rssMB":5934,"maxMB":4096,"oldBatchSize":50,"newBatchSize":25}
- **analyze**: [WARN] Memory pressure detected, reducing batch size {"rssMB":4521,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **diff**: [WARN] Memory pressure detected, reducing batch size {"rssMB":4464,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **update**: [WARN] Memory pressure detected, reducing batch size {"rssMB":4564,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
