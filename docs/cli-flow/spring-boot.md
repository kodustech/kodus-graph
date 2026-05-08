# CLI flow validation: spring-boot

- repo: `https://github.com/spring-projects/spring-boot`
- language: java
- target file (for analyze/context/diff): `buildpack/spring-boot-buildpack-platform/src/test/java/org/springframework/boot/buildpack/platform/docker/configuration/DockerConfigurationMetadataTests.java`
- max-memory: 4096 MB
- timestamp: 2026-05-04T17:41:57Z

## Parse result

- files_parsed: 1177
- total_nodes: 84199
- total_edges: 245519
- tier_distribution: receiver=27821 di=12044 same=20754 import=92 unique=23067 ambig=94603 noise=43

## CLI command results

| Command | Exit | Duration (s) | Output bytes | Warnings/Errors |
|---|---|---|---|---|
| parse | 0 | 2672 | 550409241 | 0 |
| analyze | 0 | 4 | 4309 | 1 |
| context_prompt | 0 | 38 | 138 | 1 |
| context_json | 0 | 38 | 612268679 | 1 |
| diff | 0 | 5 | 85529 | 1 |
| search | 0 | 5 | 39505 | 0 |
| communities | 0 | 120 | 1685135 | 0 |
| flows | 0 | 8 | 440887560 | 0 |
| update | 0 | 20 | 584348498 | 5 |

## Notes

- **analyze**: [WARN] Memory pressure detected, reducing batch size {"rssMB":3252,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **diff**: [WARN] Memory pressure detected, reducing batch size {"rssMB":2164,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
- **update**: [WARN] Memory pressure detected, reducing batch size {"rssMB":3268,"maxMB":768,"oldBatchSize":50,"newBatchSize":25}
