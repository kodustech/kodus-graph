# CLI flow validation: nestjs-nest

- repo: `https://github.com/nestjs/nest`
- language: TypeScript
- target file (for analyze/context/diff): `tools/gulp/gulpfile.ts`
- max-memory: 2048 MB
- timestamp: 2026-05-04T17:42:25Z

## Parse result

- files_parsed: 204
- total_nodes: 14515
- total_edges: 25070
- tier_distribution: receiver=2581 di=293 same=1734 import=772 unique=606 ambig=3180 noise=56

## CLI command results

| Command | Exit | Duration (s) | Output bytes | Warnings/Errors |
|---|---|---|---|---|
| parse | 0 | 8 | 16066219 | 391 |
| analyze | 0 | 1 | 644 | 0 |
| context_prompt | 0 | 0 | 294 | 0 |
| context_json | 0 | 1 | 20142364 | 0 |
| diff | 0 | 2 | 361 | 0 |
| search | 0 | 3 | 26874 | 0 |
| communities | 0 | 3 | 140840 | 0 |
| flows | 0 | 1 | 4537346 | 0 |
| update | 0 | 1 | 16885543 | 0 |

## Notes

- **parse**: [WARN] No import resolver registered for language {"lang":"TypeScript","module":"./identity.deserializer","from":"/tmp/kodus-graph-cli-flow/nestjs-nest/packages/microservices/deserializers/index.ts"}
