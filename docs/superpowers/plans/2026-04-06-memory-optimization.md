# Memory Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `kodus-graph parse --all` to handle repos with 66K+ nodes in E2B sandboxes (512 MB RAM) without OOM.

**Architecture:** Replace monolithic `JSON.stringify` with streaming write, release intermediate data structures after consumption, filter noise calls during extraction, and add `--include`/`--exclude` glob filters for scope control.

**Tech Stack:** Bun (runtime + Glob API), Node.js fs streams, `@ast-grep/napi`, `commander`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/graph/json-writer.ts` | Create | Stream graph JSON to disk without holding full string in memory |
| `src/commands/parse.ts` | Modify | Use streaming writer + release intermediaries after consumption |
| `src/parser/batch.ts` | Modify | Filter noise calls during extraction (before pushing to rawCalls) |
| `src/parser/discovery.ts` | Modify | Apply include/exclude glob filters after file walk |
| `src/cli.ts` | Modify | Add `--include` and `--exclude` repeatable options to parse command |
| `tests/graph/json-writer.test.ts` | Create | Verify streaming writer produces valid, parseable JSON |
| `tests/parser/discovery.test.ts` | Create | Verify include/exclude glob filtering |
| `tests/e2e.test.ts` | Modify | Ensure E2E tests still pass with compact JSON output |

---

### Task 1: Streaming JSON Writer

**Files:**
- Create: `src/graph/json-writer.ts`
- Test: `tests/graph/json-writer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/graph/json-writer.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import type { GraphEdge, GraphNode, ParseMetadata } from '../../src/graph/types';
import { writeGraphJSON } from '../../src/graph/json-writer';

describe('writeGraphJSON', () => {
  const OUT = '/tmp/kodus-graph-json-writer-test.json';

  const metadata: ParseMetadata = {
    repo_dir: '/repo',
    files_parsed: 2,
    total_nodes: 2,
    total_edges: 1,
    duration_ms: 100,
    parse_errors: 0,
    extract_errors: 0,
  };

  const nodes: GraphNode[] = [
    {
      kind: 'Function',
      name: 'foo',
      qualified_name: 'src/a.ts::foo',
      file_path: 'src/a.ts',
      line_start: 1,
      line_end: 5,
      language: 'typescript',
      is_test: false,
      file_hash: 'abc123',
    },
    {
      kind: 'Class',
      name: 'Bar',
      qualified_name: 'src/b.ts::Bar',
      file_path: 'src/b.ts',
      line_start: 1,
      line_end: 20,
      language: 'typescript',
      is_test: false,
      file_hash: 'def456',
    },
  ];

  const edges: GraphEdge[] = [
    {
      kind: 'CALLS',
      source_qualified: 'src/a.ts::foo',
      target_qualified: 'src/b.ts::Bar',
      file_path: 'src/a.ts',
      line: 3,
      confidence: 0.85,
    },
  ];

  it('should produce valid JSON parseable by JSON.parse', () => {
    writeGraphJSON(OUT, metadata, nodes, edges);
    const raw = readFileSync(OUT, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.metadata.repo_dir).toBe('/repo');
    expect(parsed.metadata.total_nodes).toBe(2);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.nodes[0].name).toBe('foo');
    expect(parsed.nodes[1].name).toBe('Bar');
    expect(parsed.edges[0].kind).toBe('CALLS');

    rmSync(OUT, { force: true });
  });

  it('should handle empty nodes and edges', () => {
    const emptyMeta: ParseMetadata = {
      ...metadata,
      total_nodes: 0,
      total_edges: 0,
    };
    writeGraphJSON(OUT, emptyMeta, [], []);
    const parsed = JSON.parse(readFileSync(OUT, 'utf-8'));

    expect(parsed.nodes).toHaveLength(0);
    expect(parsed.edges).toHaveLength(0);

    rmSync(OUT, { force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/graph/json-writer.test.ts`
Expected: FAIL with "Cannot find module" or "writeGraphJSON is not a function"

- [ ] **Step 3: Write the streaming JSON writer**

Create `src/graph/json-writer.ts`:

```typescript
import { writeFileSync, openSync, writeSync, closeSync } from 'fs';
import type { GraphEdge, GraphNode, ParseMetadata } from './types';

/**
 * Write graph output as JSON to disk using incremental serialization.
 *
 * Instead of JSON.stringify on the full output (which creates a ~100-300 MB
 * string for large repos), this writes each node/edge individually.
 * Peak memory: only one JSON.stringify(singleNode) string at a time (~1 KB).
 */
export function writeGraphJSON(
  out: string,
  metadata: ParseMetadata,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const fd = openSync(out, 'w');

  try {
    writeSync(fd, '{"metadata":');
    writeSync(fd, JSON.stringify(metadata));

    // Nodes
    writeSync(fd, ',"nodes":[');
    for (let i = 0; i < nodes.length; i++) {
      if (i > 0) writeSync(fd, ',');
      writeSync(fd, '\n');
      writeSync(fd, JSON.stringify(nodes[i]));
    }
    writeSync(fd, '\n]');

    // Edges
    writeSync(fd, ',"edges":[');
    for (let i = 0; i < edges.length; i++) {
      if (i > 0) writeSync(fd, ',');
      writeSync(fd, '\n');
      writeSync(fd, JSON.stringify(edges[i]));
    }
    writeSync(fd, '\n]}');
  } finally {
    closeSync(fd);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/graph/json-writer.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/json-writer.ts tests/graph/json-writer.test.ts
git commit -m "feat: add streaming JSON writer for memory-efficient graph serialization"
```

---

### Task 2: Wire Streaming Writer into Parse Command + Release Intermediaries

**Files:**
- Modify: `src/commands/parse.ts`

- [ ] **Step 1: Run existing tests to confirm green baseline**

Run: `bun test`
Expected: All 163 tests pass

- [ ] **Step 2: Replace writeFileSync with streaming writer and release intermediaries**

Replace the full content of `src/commands/parse.ts` with:

```typescript
import { resolve, relative } from 'path';
import { performance } from 'perf_hooks';
import { buildGraphData } from '../graph/builder';
import { writeGraphJSON } from '../graph/json-writer';
import type { ImportEdge } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';

export interface ParseOptions {
  repoDir: string;
  files?: string[];
  all: boolean;
  out: string;
  include?: string[];
  exclude?: string[];
}

export async function executeParse(opts: ParseOptions): Promise<void> {
  const t0 = performance.now();
  const repoDir = resolve(opts.repoDir);

  // Phase 1: Discover files
  const files = discoverFiles(repoDir, opts.all ? undefined : opts.files, opts.include, opts.exclude);
  process.stderr.write(`[1/5] Discovered ${files.length} files\n`);

  // Phase 2: Parse + extract
  let rawGraph = await parseBatch(files, repoDir);
  process.stderr.write(
    `[2/5] Parsed ${rawGraph.functions.length} functions, ${rawGraph.classes.length} classes, ${rawGraph.rawCalls.length} call sites\n`,
  );

  // Phase 3: Resolve imports
  const tsconfigAliases = loadTsconfigAliases(repoDir);
  let symbolTable = createSymbolTable();
  let importMap = createImportMap();
  let importEdges: ImportEdge[] = [];

  for (const f of rawGraph.functions) symbolTable.add(f.file, f.name, f.qualified);
  for (const c of rawGraph.classes) symbolTable.add(c.file, c.name, c.qualified);
  for (const i of rawGraph.interfaces) symbolTable.add(i.file, i.name, i.qualified);

  for (const imp of rawGraph.imports) {
    const langKey = imp.lang === 'python' ? 'python' : imp.lang === 'ruby' ? 'ruby' : 'typescript';
    const resolved = resolveImport(resolve(repoDir, imp.file), imp.module, langKey, repoDir, tsconfigAliases);
    const resolvedRel = resolved ? relative(repoDir, resolved) : null;
    importEdges.push({
      source: imp.file,
      target: resolvedRel || imp.module,
      resolved: !!resolvedRel,
      line: imp.line,
    });
    const target = resolvedRel || imp.module;
    for (const name of imp.names) importMap.add(imp.file, name, target);
  }

  process.stderr.write(
    `[3/5] Resolved ${importEdges.filter((e) => e.resolved).length}/${importEdges.length} imports\n`,
  );

  // Phase 4: Resolve calls
  let { callEdges, stats } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);
  process.stderr.write(
    `[4/5] Resolved ${callEdges.length} calls (DI:${stats.di} same:${stats.same} import:${stats.import} unique:${stats.unique} ambiguous:${stats.ambiguous} noise:${stats.noise})\n`,
  );

  // Phase 5: Build output
  const fileHashes = new Map<string, string>();
  for (const f of files) {
    try {
      fileHashes.set(relative(repoDir, f), computeFileHash(f));
    } catch (err) {
      log.warn('Failed to compute file hash', { file: f, error: String(err) });
    }
  }

  const parseErrors = rawGraph.parseErrors;
  const extractErrors = rawGraph.extractErrors;
  const graphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes);
  process.stderr.write(`[5/5] Built graph: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges\n`);

  // Release intermediaries — no longer needed after buildGraphData
  rawGraph = null as any;
  symbolTable = null as any;
  importMap = null as any;
  callEdges = null as any;
  importEdges = null as any;

  const metadata = {
    repo_dir: repoDir,
    files_parsed: files.length,
    total_nodes: graphData.nodes.length,
    total_edges: graphData.edges.length,
    duration_ms: Math.round(performance.now() - t0),
    parse_errors: parseErrors,
    extract_errors: extractErrors,
  };

  writeGraphJSON(opts.out, metadata, graphData.nodes, graphData.edges);
}
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass. The E2E tests use `JSON.parse(readFileSync(...))` which works on compact JSON.

- [ ] **Step 4: Commit**

```bash
git add src/commands/parse.ts
git commit -m "feat: use streaming JSON writer and release intermediaries in parse command"
```

---

### Task 3: Noise Filter at Extraction

**Files:**
- Modify: `src/parser/batch.ts`

- [ ] **Step 1: Run existing tests to confirm green baseline**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 2: Add noise filtering in batch.ts**

Replace the full content of `src/parser/batch.ts` with:

```typescript
import type { SgRoot } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { extname, relative } from 'path';
import type { ParseBatchResult, RawCallSite, RawGraph } from '../graph/types';
import { NOISE } from '../shared/filters';
import { log } from '../shared/logger';
import { extractCallsFromFile, extractFromFile } from './extractor';
import { getLanguage } from './languages';

const BATCH_SIZE = 50;

export async function parseBatch(files: string[], repoRoot: string): Promise<ParseBatchResult> {
  const graph: RawGraph = {
    functions: [],
    classes: [],
    interfaces: [],
    enums: [],
    tests: [],
    imports: [],
    reExports: [],
    rawCalls: [],
    diMaps: new Map(),
  };
  const seen = new Set<string>();
  let parseErrors = 0;
  let extractErrors = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (filePath) => {
      const lang = getLanguage(extname(filePath));
      if (!lang) return;

      let source: string;
      try {
        source = readFileSync(filePath, 'utf-8');
      } catch (err) {
        log.warn('Failed to read file', { file: filePath, error: String(err) });
        parseErrors++;
        return;
      }

      let root: SgRoot;
      try {
        root = await parseAsync(lang, source);
      } catch (err) {
        log.warn('Failed to parse file', { file: filePath, error: String(err) });
        parseErrors++;
        return;
      }

      const fp = relative(repoRoot, filePath);

      try {
        extractFromFile(root, fp, lang, seen, graph);
      } catch (err) {
        log.error('Extraction crashed', { file: fp, error: String(err) });
        extractErrors++;
      }

      try {
        // Extract calls into a temporary buffer, then filter noise before pushing
        const rawCalls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, lang, rawCalls);
        for (const call of rawCalls) {
          if (!NOISE.has(call.callName)) {
            graph.rawCalls.push(call);
          }
        }
      } catch (err) {
        log.error('Call extraction crashed', { file: fp, error: String(err) });
        extractErrors++;
      }
    });

    await Promise.all(promises);
  }

  return { ...graph, parseErrors, extractErrors };
}
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass. The noise stat in the resolver will now be 0 (or near-zero) since noise calls never reach it — this is expected and correct.

- [ ] **Step 4: Commit**

```bash
git add src/parser/batch.ts
git commit -m "perf: filter noise calls during extraction to reduce rawCalls array size"
```

---

### Task 4: Include/Exclude Glob Filters — Discovery

**Files:**
- Modify: `src/parser/discovery.ts`
- Test: `tests/parser/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/parser/discovery.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { discoverFiles } from '../../src/parser/discovery';

const TMP = '/tmp/kodus-graph-discovery-test';

function setupFixture() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'src/core'), { recursive: true });
  mkdirSync(join(TMP, 'src/utils'), { recursive: true });
  mkdirSync(join(TMP, 'tests'), { recursive: true });
  mkdirSync(join(TMP, 'vendor'), { recursive: true });
  writeFileSync(join(TMP, 'src/core/auth.ts'), 'export function login() {}');
  writeFileSync(join(TMP, 'src/core/auth.test.ts'), 'test("login", () => {})');
  writeFileSync(join(TMP, 'src/utils/helpers.ts'), 'export function help() {}');
  writeFileSync(join(TMP, 'tests/e2e.ts'), 'test("e2e", () => {})');
  writeFileSync(join(TMP, 'vendor/lib.ts'), 'export function vendored() {}');
}

describe('discoverFiles with include/exclude', () => {
  it('should return all files when no include/exclude', () => {
    setupFixture();
    const files = discoverFiles(TMP);
    // vendor is in SKIP_DIRS, so 4 files: auth.ts, auth.test.ts, helpers.ts, e2e.ts
    expect(files.length).toBe(4);
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should filter by include pattern', () => {
    setupFixture();
    const files = discoverFiles(TMP, undefined, ['src/core/**']);
    const names = files.map((f) => f.split('/').pop());
    expect(names).toContain('auth.ts');
    expect(names).toContain('auth.test.ts');
    expect(names).not.toContain('helpers.ts');
    expect(names).not.toContain('e2e.ts');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should filter by exclude pattern', () => {
    setupFixture();
    const files = discoverFiles(TMP, undefined, undefined, ['**/*.test.*']);
    const names = files.map((f) => f.split('/').pop());
    expect(names).toContain('auth.ts');
    expect(names).toContain('helpers.ts');
    expect(names).not.toContain('auth.test.ts');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should apply include then exclude', () => {
    setupFixture();
    const files = discoverFiles(TMP, undefined, ['src/**'], ['**/*.test.*']);
    const names = files.map((f) => f.split('/').pop());
    expect(names).toContain('auth.ts');
    expect(names).toContain('helpers.ts');
    expect(names).not.toContain('auth.test.ts');
    expect(names).not.toContain('e2e.ts');
    rmSync(TMP, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/parser/discovery.test.ts`
Expected: FAIL — `discoverFiles` does not accept include/exclude parameters yet.

- [ ] **Step 3: Update discovery.ts to support include/exclude**

Replace the full content of `src/parser/discovery.ts` with:

```typescript
import { readdirSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { isSkippableFile, SKIP_DIRS } from '../shared/filters';
import { log } from '../shared/logger';
import { ensureWithinRoot } from '../shared/safe-path';
import { getLanguage } from './languages';

/**
 * Walk the filesystem and find all supported source files.
 * If `filterFiles` is provided, only return those specific files (resolved to absolute paths).
 * If `include` patterns are provided, keep only files matching at least one pattern.
 * If `exclude` patterns are provided, remove files matching any pattern.
 */
export function discoverFiles(
  repoDir: string,
  filterFiles?: string[],
  include?: string[],
  exclude?: string[],
): string[] {
  const absRepoDir = resolve(repoDir);

  if (filterFiles) {
    return filterFiles
      .map((f) => (f.startsWith('/') ? f : join(absRepoDir, f)))
      .filter((f) => {
        try {
          ensureWithinRoot(f, absRepoDir);
          return getLanguage(extname(f)) !== null;
        } catch (err) {
          log.warn('Skipping file outside repository root', { file: f, error: String(err) });
          return false;
        }
      });
  }

  let files: string[] = [];
  walkFiles(absRepoDir, files);

  // Apply include/exclude filters using Bun.Glob
  const hasInclude = include && include.length > 0;
  const hasExclude = exclude && exclude.length > 0;

  if (hasInclude || hasExclude) {
    const includeGlobs = hasInclude ? include.map((p) => new Bun.Glob(p)) : null;
    const excludeGlobs = hasExclude ? exclude.map((p) => new Bun.Glob(p)) : null;

    files = files.filter((absPath) => {
      const rel = relative(absRepoDir, absPath);

      // If include patterns exist, file must match at least one
      if (includeGlobs && !includeGlobs.some((g) => g.match(rel))) {
        return false;
      }

      // If exclude patterns exist, file must not match any
      if (excludeGlobs && excludeGlobs.some((g) => g.match(rel))) {
        return false;
      }

      return true;
    });
  }

  return files;
}

function walkFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      walkFiles(join(dir, entry.name), files);
    } else if (entry.isFile() && getLanguage(extname(entry.name)) !== null && !isSkippableFile(entry.name)) {
      files.push(join(dir, entry.name));
    }
  }
}
```

- [ ] **Step 4: Run discovery tests**

Run: `bun test tests/parser/discovery.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/parser/discovery.ts tests/parser/discovery.test.ts
git commit -m "feat: add --include/--exclude glob filtering to file discovery"
```

---

### Task 5: Include/Exclude CLI Flags

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add --include and --exclude options to the parse command**

In `src/cli.ts`, find the parse command definition (lines 18-37) and replace it with:

```typescript
program
  .command('parse')
  .description('Parse source files and generate nodes + edges')
  .option('--all', 'Parse all files in repo')
  .option('--files <paths...>', 'Parse specific files')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--include <glob...>', 'Include only files matching glob (repeatable)')
  .option('--exclude <glob...>', 'Exclude files matching glob (repeatable)')
  .requiredOption('--out <path>', 'Output JSON file path')
  .action(async (opts) => {
    const repoDir = resolve(opts.repoDir);
    if (!existsSync(repoDir)) {
      process.stderr.write(`Error: --repo-dir does not exist: ${repoDir}\n`);
      process.exit(1);
    }
    await executeParse({
      repoDir: opts.repoDir,
      files: opts.files,
      all: opts.all ?? false,
      out: opts.out,
      include: opts.include,
      exclude: opts.exclude,
    });
  });
```

- [ ] **Step 2: Run E2E tests to verify CLI still works**

Run: `bun test tests/e2e.test.ts`
Expected: All E2E tests pass

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --include/--exclude CLI flags to parse command"
```

---

### Task 6: E2E Validation and Version Bump

**Files:**
- Modify: `tests/e2e.test.ts`
- Modify: `src/cli.ts` (version)
- Modify: `package.json` (version)

- [ ] **Step 1: Add E2E test for include/exclude**

Add the following test to `tests/e2e.test.ts`, after the existing `parse --files` test:

```typescript
  it('parse --all --exclude should skip excluded files', () => {
    const out = '/tmp/kodus-graph-e2e-parse-exclude.json';
    execSync(`bun run ${CLI} parse --all --repo-dir ${FIXTURE} --exclude "**/*.test.*" --out ${out}`);
    const result = JSON.parse(readFileSync(out, 'utf-8'));

    expect(result.metadata.files_parsed).toBeGreaterThan(0);
    // No test file nodes should be present since we excluded *.test.* files
    for (const node of result.nodes) {
      expect(node.file_path).not.toMatch(/\.test\./);
    }

    rmSync(out, { force: true });
  });
```

- [ ] **Step 2: Run E2E tests**

Run: `bun test tests/e2e.test.ts`
Expected: All E2E tests pass (including the new one)

- [ ] **Step 3: Bump version to 0.3.0**

In `src/cli.ts` line 16, change:
```typescript
program.name('kodus-graph').description('Code graph builder for Kodus code review').version('0.3.0');
```

In `package.json`, change `"version"` to `"0.3.0"`.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add tests/e2e.test.ts src/cli.ts package.json
git commit -m "feat: add E2E test for exclude filter, bump version to 0.3.0"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Streaming JSON write → Task 1
- [x] Release intermediaries → Task 2
- [x] Noise filter at extraction → Task 3
- [x] `--include`/`--exclude` globs → Tasks 4 + 5
- [x] Backward compatibility (loadGraph works with compact JSON) → Verified in analysis
- [x] E2E validation → Task 6
- [x] All 163 existing tests pass → Checked in Tasks 2, 3, 4, 5, 6

**Placeholder scan:** No TBD, TODO, or vague steps found.

**Type consistency:**
- `ParseOptions` in Task 2 adds `include?: string[]` and `exclude?: string[]` — matches Task 4's `discoverFiles` signature
- `writeGraphJSON` signature in Task 1 matches usage in Task 2
- `NOISE` import in Task 3 matches existing export from `src/shared/filters.ts`
