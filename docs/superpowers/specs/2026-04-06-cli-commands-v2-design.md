# kodus-graph CLI v2 — 5 New Commands Design

## Goal

Add 5 new CLI commands (`diff`, `update`, `communities`, `flows`, `search`) to kodus-graph, absorbing the best features from code-review-graph (Python) and kodus-service-ast (NestJS) into a standalone Bun CLI.

## Architecture

All new commands share a common `loadGraph()` factory that reads `ParseOutput` JSON and builds in-memory indices (adjacency lists, qualified name maps). Each command is a pure function receiving the indexed graph. No new external dependencies.

**Tech Stack:** Bun runtime, TypeScript, ast-grep (existing), commander (existing).

## Decisions Record

| Decision | Choice | Rationale |
|----------|--------|-----------|
| diff: changed files source | `--base` (git) OR `--files` (explicit) | Flexible: CI has files, local devs prefer git ref |
| update: graph persistence | `--graph` explicit OR `.kodus-graph/graph.json` default | Good DX locally, explicit in CI |
| communities: algorithm | File-based grouping + coupling analysis | No external deps, 80% of value, swappable later |
| flows: entry points | Tests (`kind: Test`) + HTTP handlers (pattern match) | Focused on code review value |
| search: scope | Text match + structural filters + relation queries | No fuzzy, high value for code review |
| graph format | Same `ParseOutput` JSON from `parse` | Zero format changes, indices built in memory |
| code architecture | Hybrid functional — `loadGraph()` factory + pure functions | Consistent with existing codebase style |

---

## Shared: Graph Loader

**File:** `src/graph/loader.ts`

Reads `ParseOutput` JSON, validates with Zod, builds in-memory indices in a single pass.

```typescript
interface IndexedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byQualified: Map<string, GraphNode>;        // qualified_name -> node
  byFile: Map<string, GraphNode[]>;           // file_path -> nodes in that file
  adjacency: Map<string, GraphEdge[]>;        // source_qualified -> outgoing edges
  reverseAdjacency: Map<string, GraphEdge[]>; // target_qualified -> incoming edges
  edgesByKind: Map<string, GraphEdge[]>;      // edge kind -> edges of that type
  metadata: ParseMetadata;
}

function loadGraph(path: string): IndexedGraph
```

All 5 new commands use `loadGraph()` as entry point. Existing `analyze` and `context` commands can be refactored to use it too (optional, not required for this sprint).

---

## Command 1: `diff`

Compares changed files against an existing graph. Shows structural changes (added/removed/modified nodes and edges).

### CLI

```
kodus-graph diff --repo-dir . --base main --out diff.json
kodus-graph diff --repo-dir . --files src/auth.ts src/db.ts --graph graph.json --out diff.json
```

### Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--base <ref>` | No* | — | Git ref to diff against (runs `git diff --name-only`) |
| `--files <paths...>` | No* | — | Explicit list of changed files |
| `--graph <path>` | No | `.kodus-graph/graph.json` | Previous graph to compare against |
| `--repo-dir <path>` | No | `.` | Repository root |
| `--out <path>` | Yes | — | Output JSON path |

*One of `--base` or `--files` is required.

### Logic (`src/commands/diff.ts` + `src/analysis/diff.ts`)

1. Resolve changed files (via `--base` with `git diff --name-only` or `--files`)
2. Load previous graph via `loadGraph()`
3. Re-parse ONLY changed files (`parseBatch` with filtered list)
4. Compare nodes by `qualified_name`: classify as `added`, `removed`, `modified` (line range or params changed)
5. Compare edges: source or target in changed file — classify as `added`, `removed`
6. Calculate risk per file (how many dependents are impacted via reverse adjacency)

### Output

```json
{
  "changed_files": ["src/auth.ts"],
  "summary": { "added": 3, "removed": 1, "modified": 2 },
  "nodes": {
    "added": [{ "qualified_name": "src/auth.ts::newFunc", "kind": "Function", "file_path": "src/auth.ts", "line_start": 10, "line_end": 15 }],
    "removed": [{ "qualified_name": "src/auth.ts::oldFunc", "kind": "Function", "file_path": "src/auth.ts", "line_start": 5, "line_end": 8 }],
    "modified": [{ "qualified_name": "src/auth.ts::AuthService.login", "changes": ["params", "line_range"] }]
  },
  "edges": {
    "added": [{ "kind": "CALLS", "source_qualified": "...", "target_qualified": "..." }],
    "removed": [{ "kind": "CALLS", "source_qualified": "...", "target_qualified": "..." }]
  },
  "risk_by_file": {
    "src/auth.ts": { "dependents": 12, "risk": "HIGH" }
  }
}
```

---

## Command 2: `update`

Incremental parse — only re-parses files that changed since the last graph. Uses file hashes for change detection.

### CLI

```
kodus-graph update --repo-dir .
kodus-graph update --repo-dir . --graph old.json --out new.json
```

### Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--graph <path>` | No | `.kodus-graph/graph.json` | Previous graph |
| `--out <path>` | No | Same as `--graph` (overwrites) | Where to save updated graph |
| `--repo-dir <path>` | No | `.` | Repository root |

### Logic (`src/commands/update.ts`)

1. Load previous graph via `loadGraph()`
2. Discover all files in repo (`discoverFiles`)
3. Compare `file_hash` from previous graph vs current hash of each file
4. Classify: `unchanged` (hash match), `modified` (hash different), `added` (new file), `deleted` (no longer exists)
5. Re-parse ONLY `modified` + `added` via `parseBatch`
6. Merge: remove nodes/edges from `modified` + `deleted` files in previous graph, add new parse results
7. Re-resolve imports and calls for affected files
8. Save updated graph
9. If `--out` not provided, save to `.kodus-graph/graph.json` (create dir if needed)

### Output

Same `ParseOutput` format as `parse`, with extended metadata:

```json
{
  "metadata": {
    "repo_dir": "/path/to/repo",
    "files_parsed": 3,
    "files_unchanged": 11377,
    "files_total": 11380,
    "total_nodes": 86700,
    "total_edges": 177465,
    "duration_ms": 850,
    "parse_errors": 0,
    "extract_errors": 0,
    "incremental": true
  },
  "nodes": [],
  "edges": []
}
```

`ParseMetadata` gains 2 new optional fields: `files_unchanged: number` and `incremental: boolean`. Backward-compatible.

---

## Command 3: `communities`

Detects module clusters based on directory structure + coupling via edges.

### CLI

```
kodus-graph communities --graph graph.json --out communities.json
kodus-graph communities --graph graph.json --min-size 3 --depth 3 --out communities.json
```

### Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--graph <path>` | Yes | — | Graph JSON input |
| `--out <path>` | Yes | — | Output JSON path |
| `--min-size <n>` | No | `2` | Minimum nodes for a community to appear |
| `--depth <n>` | No | `2` | Directory grouping depth (`src/auth` at depth 2) |

### Logic (`src/commands/communities.ts` + `src/analysis/communities.ts`)

1. Load graph via `loadGraph()`
2. Group nodes by directory (up to `--depth` levels): `src/auth/service.ts` -> community `src/auth`
3. For each pair of communities, count cross-edges (CALLS + IMPORTS between them) -> coupling score
4. Calculate internal cohesion: internal edges / total possible edges
5. Classify coupling: `HIGH` (>30% edges cross), `MEDIUM` (10-30%), `LOW` (<10%)
6. Filter communities smaller than `--min-size`

### Output

```json
{
  "communities": [
    {
      "name": "src/auth",
      "files": ["src/auth/service.ts", "src/auth/guard.ts"],
      "node_count": 15,
      "cohesion": 0.72,
      "language": "typescript"
    }
  ],
  "coupling": [
    {
      "source": "src/auth",
      "target": "src/users",
      "edges": 8,
      "strength": "HIGH"
    }
  ],
  "summary": {
    "total_communities": 12,
    "avg_cohesion": 0.65,
    "high_coupling_pairs": 3
  }
}
```

---

## Command 4: `flows`

Detects entry points (tests and HTTP handlers) and traces execution paths through the graph.

### CLI

```
kodus-graph flows --graph graph.json --out flows.json
kodus-graph flows --graph graph.json --max-depth 5 --type http --out flows.json
```

### Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--graph <path>` | Yes | — | Graph JSON input |
| `--out <path>` | Yes | — | Output JSON path |
| `--max-depth <n>` | No | `10` | Max BFS depth for tracing |
| `--type <kind>` | No | `all` | Filter: `test`, `http`, `all` |

### Logic (`src/commands/flows.ts` + `src/analysis/flows.ts`)

1. Load graph via `loadGraph()`
2. Identify entry points by pattern:
   - **test**: nodes with `kind: "Test"` (already extracted by parser)
   - **http**: functions whose name matches HTTP handler patterns (`get`, `post`, `put`, `delete`, `patch` as class methods, or targets of CALLS edges from `app.get()`, `router.post()` patterns)
3. For each entry point, BFS via CALLS edges (using `adjacency` from `IndexedGraph`) up to `--max-depth`
4. Calculate criticality per flow: `node_count * file_count`
5. Sort by criticality descending

### Entry Point Detection Patterns

**Tests:** `node.kind === 'Test'` (already classified by parser).

**HTTP handlers:** Match function name against:
- Method names: `get`, `post`, `put`, `delete`, `patch`, `handle`, `handler`
- NestJS-style: method in a class whose name ends with `Controller`
- Express-style: target of CALLS edge where caller is `app.get`, `router.post`, etc.

### Output

```json
{
  "flows": [
    {
      "entry_point": "tests/auth.test.ts::test:should authenticate valid user",
      "type": "test",
      "depth": 3,
      "node_count": 7,
      "file_count": 3,
      "criticality": 21,
      "path": [
        "tests/auth.test.ts::test:should authenticate valid user",
        "src/auth.ts::AuthService.authenticate",
        "src/db.ts::findUser"
      ]
    }
  ],
  "summary": {
    "total_flows": 145,
    "by_type": { "test": 120, "http": 25 },
    "avg_depth": 3.2,
    "max_criticality": 84
  }
}
```

---

## Command 5: `search`

Structural search across the graph — text matching, kind/file filters, and relation queries.

### CLI

```
kodus-graph search --graph graph.json --query "authenticate"
kodus-graph search --graph graph.json --query "Auth*" --kind Class
kodus-graph search --graph graph.json --callers-of "src/db.ts::findUser"
kodus-graph search --graph graph.json --callees-of "src/auth.ts::AuthService.authenticate"
kodus-graph search --graph graph.json --query "validate" --file "src/auth*"
```

### Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--graph <path>` | Yes | — | Graph JSON input |
| `--query <pattern>` | No* | — | Search by name/qualified_name (glob `*` or regex `/pattern/`) |
| `--kind <type>` | No | — | Filter: `Function`, `Method`, `Class`, `Interface`, `Enum`, `Test` |
| `--file <pattern>` | No | — | Filter by file_path (glob) |
| `--callers-of <qualified>` | No* | — | Who calls this node (reverse CALLS) |
| `--callees-of <qualified>` | No* | — | Who this node calls (forward CALLS) |
| `--limit <n>` | No | `50` | Max results |
| `--out <path>` | No | stdout | Optional file output |

*One of `--query`, `--callers-of`, or `--callees-of` is required. Mutually exclusive.

### Logic (`src/commands/search.ts` + `src/analysis/search.ts`)

1. Load graph via `loadGraph()`
2. If `--callers-of`: use `reverseAdjacency` to find CALLS edges -> resolve source nodes
3. If `--callees-of`: use `adjacency` to find CALLS edges -> resolve target nodes
4. If `--query`: iterate nodes, match by name/qualified_name. If starts with `/`, treat as regex. If contains `*`, convert to regex glob.
5. Apply `--kind` and `--file` filters on results
6. Limit to `--limit`, sort by file_path + line_start
7. Write to stdout (default) or `--out` file

### Output

```json
{
  "results": [
    {
      "qualified_name": "src/auth.ts::AuthService.authenticate",
      "name": "authenticate",
      "kind": "Method",
      "file_path": "src/auth.ts",
      "line_start": 11,
      "line_end": 15,
      "parent_name": "AuthService"
    }
  ],
  "total": 1,
  "query": { "pattern": "authenticate", "kind": null, "file": null }
}
```

---

## File Structure (new files)

```
src/
  graph/
    loader.ts          # NEW: loadGraph() + IndexedGraph
  commands/
    diff.ts            # NEW
    update.ts          # NEW
    communities.ts     # NEW
    flows.ts           # NEW
    search.ts          # NEW
  analysis/
    diff.ts            # NEW: structural diff logic
    communities.ts     # NEW: directory grouping + coupling
    flows.ts           # NEW: entry point detection + BFS
    search.ts          # NEW: text match + relation queries
```

Total: 10 new files. Existing files modified: `cli.ts` (add 5 commands), `graph/types.ts` (add 2 optional fields to `ParseMetadata`).

---

## Error Handling

- Missing `--graph` file and no `.kodus-graph/graph.json`: clear error message, exit 1
- Invalid graph JSON (Zod validation fails): error with details, exit 1
- `--base` ref doesn't exist: `git diff` fails, catch and show "invalid git ref", exit 1
- Neither `--base` nor `--files` in `diff`: error "one of --base or --files required", exit 1
- Mutually exclusive flags in `search`: error "use --query, --callers-of, or --callees-of (not combined)", exit 1
- All errors go to stderr. Only `search` stdout output is JSON data.

## Testing Strategy

Each new command gets:
- Unit tests for the analysis logic (pure functions, no I/O)
- Integration test with sample-repo fixtures
- Tests live in `tests/analysis/<name>.test.ts` and `tests/commands/<name>.test.ts`
