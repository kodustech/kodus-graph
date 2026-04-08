# kodus-graph Memory Optimization Design

## Goal

Enable `kodus-graph parse --all` to handle large repos (7K-17K files, 66K+ nodes, 129K+ edges) within E2B sandbox memory constraints (512 MB RAM). Currently, keycloak (7K files) causes OOM (exit 137) and sentry (17K files) times out.

## Root Cause

Peak memory during `parse --all` on keycloak:

| Phase | What's in memory | Estimated size |
|-------|-----------------|---------------|
| Phase 2 (parse) | RawGraph (66K functions/classes) + 50 in-flight ASTs | ~40 MB |
| Phase 3-4 (resolve) | RawGraph + symbolTable + importMap + callEdges | ~50-60 MB |
| Phase 5 (serialize) | graphData (66K nodes, 129K edges) + `JSON.stringify(output, null, 2)` string | **150-300 MB** |

The serialization spike in Phase 5 is the primary OOM trigger. `JSON.stringify` with pretty-print creates a single string in memory that is 1.5-2x the size of the data structures, on top of the structures themselves.

## Approach: Hybrid (Streaming + Scope Reduction)

Four changes, ordered by impact:

1. **Streaming JSON write** — eliminate the stringify spike (~80% of the fix)
2. **Release intermediaries** — GC unused structures before write (~15%)
3. **Noise filter at extraction** — reduce rawCalls array size (~3%)
4. **`--include`/`--exclude` globs** — user-controlled scope reduction (~2%, but essential for flexibility)

## Design

### 1. Streaming JSON Write

**New file:** `src/graph/json-writer.ts`

**Interface:**
```typescript
export function writeGraphJSON(
  out: string,
  metadata: ParseMetadata,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void
```

**Behavior:**
- Opens a write stream to the output file path
- Writes the JSON structure incrementally:
  1. `{"metadata":` + `JSON.stringify(metadata)` (small, ~1 KB)
  2. `,"nodes":[` then iterates nodes one by one, writing `JSON.stringify(node)` + newline separator
  3. `],"edges":[` then iterates edges one by one, same pattern
  4. `]}`
- Closes the stream synchronously (must complete before process exits)

**Output format:** Compact JSON (no pretty-print). Each node/edge on its own line for readability with `jq` and `head`. Valid JSON parseable by `loadGraph()` without changes.

**Memory impact:** The full JSON string never exists in memory. Peak drops from ~300 MB to ~50 MB (just the graph data structures).

**File changed:** `src/commands/parse.ts` line 99 — replace `writeFileSync(opts.out, JSON.stringify(output, null, 2))` with call to `writeGraphJSON()`.

### 2. Release Intermediaries

**File changed:** `src/commands/parse.ts`

**After `buildGraphData()` consumes `rawGraph`, `symbolTable`, `importMap`, `callEdges`, `importEdges`:**
- Set each reference to `null`
- Change declarations from `const` to `let` where needed

**After streaming nodes to disk:**
- Set `graphData.nodes` to empty array (release node objects for GC)

**After streaming edges to disk:**
- Set `graphData.edges` to empty array

**Ordering:** Release intermediaries BEFORE starting the streaming write. This ensures GC can reclaim ~20-30 MB before the write begins.

**Memory impact:** ~20-30 MB freed before write phase.

### 3. Noise Filter at Extraction

**File changed:** `src/parser/batch.ts`

**Current flow:**
1. `extractCallsFromFile()` pushes ALL call sites to `rawGraph.rawCalls[]`
2. `call-resolver.ts` filters out NOISE entries during resolution

**New flow:**
1. Import `NOISE` set from `src/shared/filters.ts` into `batch.ts`
2. Before pushing to `rawGraph.rawCalls[]`, check `NOISE.has(callName)` and skip if true
3. Keep the existing NOISE check in `call-resolver.ts` as a safety net (zero cost, already there)

**Impact:** ~20-30% fewer rawCalls entries. For keycloak (76K call sites), saves ~15-20K entries = ~1-3 MB.

**Output:** Identical — these calls were already filtered in the resolver. Now they're filtered earlier.

### 4. `--include` / `--exclude` Glob Filters

**Files changed:** `src/cli.ts` + `src/parser/discovery.ts`

**CLI interface:**
```bash
kodus-graph parse --all --repo-dir . --out graph.json \
  --include "src/**" \
  --exclude "**/*.test.*" --exclude "**/vendor/**"
```

Both flags are optional and repeatable (multiple `--include` / `--exclude` allowed).

**Resolution order:**
1. Discover all files (existing walk logic, respecting SKIP_DIRS + SKIP_FILE_PATTERNS)
2. If any `--include` patterns provided: keep only files matching at least one include pattern
3. If any `--exclude` patterns provided: remove files matching any exclude pattern

**Glob matching:** Use `Bun.Glob` (built-in, no new dependency). Match against the file path relative to `--repo-dir`.

**Default behavior (no flags):** Identical to current — all discovered files are parsed.

**ParseOptions update:**
```typescript
interface ParseOptions {
  repoDir: string;
  files?: string[];
  all: boolean;
  out: string;
  include?: string[];  // NEW
  exclude?: string[];  // NEW
}
```

## Memory Budget

After all 4 changes, estimated peak for keycloak (66K nodes, 129K edges):

| Phase | Before | After |
|-------|--------|-------|
| Phase 2 (parse) | ~40 MB | ~35 MB (noise filtered) |
| Phase 3-4 (resolve) | ~50-60 MB | ~50-60 MB (unchanged) |
| Phase 5 (serialize) | **150-300 MB** | **~50 MB** (streaming, intermediaries released) |
| **Peak** | **~300 MB** | **~60 MB** |

With 512 MB sandbox RAM minus ~50 MB for OS/bun runtime, we have ~400 MB headroom. The optimized peak of ~60 MB fits comfortably.

For sentry (115K nodes, 471K edges), estimated peak ~100-120 MB — still well within budget.

## Backward Compatibility

- **JSON output format:** Valid JSON, parseable by `loadGraph()`. Only difference: no indentation. Tests that compare exact JSON strings need updating to parse-then-compare.
- **CLI flags:** All new flags are optional. No-flag behavior is identical to v0.2.0.
- **ParseOutput schema:** Unchanged. Same `metadata`, `nodes`, `edges` structure.
- **context command:** Reads graph via `loadGraph()` which uses `JSON.parse()` — works on compact JSON.

## Success Criteria

1. `kodus-graph parse --all` completes on keycloak (7K files) in E2B sandbox without OOM
2. `kodus-graph parse --all` completes on sentry (17K files) in E2B sandbox without OOM or timeout
3. All 163 existing tests pass
4. Output JSON is valid and produces identical analysis results when fed to `context` command
5. `--include` / `--exclude` correctly filter discovery results

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/graph/json-writer.ts` | Create | Streaming JSON serializer |
| `src/commands/parse.ts` | Modify | Use streaming writer, release intermediaries |
| `src/parser/batch.ts` | Modify | Noise filter at extraction |
| `src/parser/discovery.ts` | Modify | Apply include/exclude globs |
| `src/cli.ts` | Modify | Add --include/--exclude flags |
| `tests/graph/json-writer.test.ts` | Create | Test streaming writer produces valid JSON |
| `tests/parser/discovery.test.ts` | Modify | Test include/exclude filtering |
| `tests/commands/parse.test.ts` | Modify | Update for compact JSON output |
