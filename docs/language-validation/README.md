# Language validation reports

One markdown report per language exercised against a real open-source
repository as part of Fase D. Numbers are snapshots; re-running the
validation harness overwrites the corresponding file.

Updated by `scripts/validate-language.ts` during Fase D task execution,
then consolidated in `src/languages/support-matrix.ts` (tier updates,
baselines, notes) by the final task of the Fase D plan.

| Language | Repo | Date | Verdict |
|---|---|---|---|
| kotlin | [Kotlin/kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) | 2026-04-19 | 🟡 GAP |
| rust | [tokio-rs/tokio](https://github.com/tokio-rs/tokio) | 2026-04-19 | 🟢 PASS |
| csharp | [serilog/serilog](https://github.com/serilog/serilog) | 2026-04-19 | 🟢 PASS |
| c | [redis/redis](https://github.com/redis/redis) | 2026-04-20 | 🟡 GAP |
| cpp | [google/flatbuffers](https://github.com/google/flatbuffers) | 2026-04-20 | 🟢 PASS |
| php | [laravel/framework](https://github.com/laravel/framework) | 2026-04-20 | 🟡 GAP |
| swift | [apple/swift-package-manager](https://github.com/apple/swift-package-manager) | 2026-04-20 | 🟢 PASS |
| dart | [google/quiver-dart](https://github.com/google/quiver-dart) | 2026-04-20 | 🟢 PASS |
| scala | [com-lihaoyi/mill](https://github.com/com-lihaoyi/mill) | 2026-04-20 | 🟢 PASS |
