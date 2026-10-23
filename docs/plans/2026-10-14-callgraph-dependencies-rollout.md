# Call Graph Dependencies Rollout Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Roll out direct callee context to the Kodus review agent without a version skew, then measure whether it closes evidence misses within the review token budget.

**Architecture:** `kodus-graph` owns XML production and is released first as `0.3.3`. `kodus-ai` pins that published version and continues to consume the same `<CallGraph>` envelope; it parses `<Callee>` as optional evidence, so older captured traces remain readable. The private replay harness validates the deployed result with only aggregate counts outside the secure environment.

**Tech Stack:** Bun, TypeScript, npm trusted publishing, Kodus sandbox, private Langfuse replay harness.

### Task 1: Verify the graph package before release

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Test: `tests/analysis/xml-formatter.test.ts`
- Test: `tests/commands/context.test.ts`

1. Run the focused XML formatter and context tests.
2. Run `bun run check`.
3. Run `bun run build:dist` and inspect the packed artifact without publishing it.
4. Confirm that the package version is `0.3.3` and that XML output contains a capped `<Callees>` section with confidence and tier.

### Task 2: Publish the graph package

**Files:**
- Modify: `.github/workflows/publish.yml` only if the release gate itself fails

1. Commit the reviewed graph changes.
2. Create and publish the matching GitHub Release for `0.3.3`.
3. Wait for the trusted-publishing workflow to finish successfully.
4. Verify the npm package reports version `0.3.3` before changing any consumer pin.

### Task 3: Upgrade the Kodus AI consumer after availability

**Files:**
- Modify: `libs/code-review/infrastructure/adapters/services/graph/kodus-graph-cli.ts` in the `kodus-ai` repository
- Test: `libs/code-review/infrastructure/adapters/services/graph/kodus-graph-cli.spec.ts` if present, otherwise add a focused install-command test

1. Change `KODUS_GRAPH_VERSION` from `0.3.0` to exactly `0.3.3`.
2. Verify sandbox installation selects the pinned package and still runs `context --format xml`.
3. Deploy the consumer only after its focused tests pass.

### Task 4: Validate production evidence and budget

**Files:**
- Run: private replay/capture files in `kodus-ai/evals/investigation/`

1. Re-run the same private candidate manifest after deployment; retain raw traces only in the restricted temporary location.
2. Report aggregates only: available graphs, changed functions, caller count, callee count, test-first caller cases, caller ordering violations, functions at cap, and XML character/token distribution.
3. Accept the rollout only when callee evidence is nonzero where resolvable, caller ordering violations are zero, and the token budget is not exceeded.
4. Run the accepted-competitor goldens separately to measure evidence recall. Do not infer model-quality gains from structural coverage alone.

No consumer pin is changed before the package is available on npm. No private source, diff, repository, trace, or credential data belongs in this repository or release notes.
