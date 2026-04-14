# @kodus/kodus-graph

[![npm version](https://img.shields.io/npm/v/@kodus/kodus-graph)](https://www.npmjs.com/package/@kodus/kodus-graph)
[![license](https://img.shields.io/npm/l/@kodus/kodus-graph)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-%23f9f1e1)](https://bun.sh)

Code graph builder for Kodus code review. Parses source code into structural graphs with nodes, edges, and analysis — enabling blast radius detection, risk scoring, test gap analysis, and enriched review context for AI agents.

## Features

- **14 languages** — TypeScript, JavaScript, Python, Ruby, Go, Java, Kotlin, Rust, C#, PHP, Swift, Dart, Scala, C/C++, Elixir
- **Structural graph** — Functions, classes, interfaces, enums as nodes; CALLS, IMPORTS, INHERITS, IMPLEMENTS, TESTED_BY, CONTAINS as edges
- **Call resolution** — 5-tier confidence cascade with DI pattern detection
- **Contract diffs** — Detects changes to params, return types, modifiers, async, and decorators (not just body edits)
- **Function-level blast radius** — Impact analysis per function, not per file
- **Smart import resolution** — tsconfig extends/rootDirs/project references, monorepo workspace exports, package.json `#imports`, Webpack/Vite aliases, Go workspaces/vendor, Maven/Gradle multi-module, Cargo workspace path deps
- **External package detection** — Distinguishes internal code from npm, pip, Maven, Cargo, etc.
- **Composable extractors** — Dedicated per-language extractor files for easy extension
- **Incremental parsing** — Content hashing skips unchanged files
- **Streaming JSON** — Memory-efficient output for large codebases

## Requirements

- [Bun](https://bun.sh) >= 1.3.0

## Installation

```bash
# Global (recommended for CLI usage)
bun install -g @kodus/kodus-graph

# Or via npm/yarn (requires Bun as runtime)
npm install -g @kodus/kodus-graph
yarn global add @kodus/kodus-graph
```

## Quick Start

```bash
# 1. Parse a repository
kodus-graph parse --all --repo-dir ./my-project --out graph.json

# 2. Analyze changed files
kodus-graph analyze --files src/auth.ts src/db.ts --graph graph.json --out analysis.json

# 3. Generate review context for AI agents
kodus-graph context --files src/auth.ts --graph graph.json --out context.json --format json
```

## Commands

### `parse`

Builds the structural graph of your codebase — extracts every function, class, interface, enum, and their relationships (calls, imports, inheritance).

**When to use:** First step in any workflow. Run once on the full repo to create the baseline graph, then use `update` for incremental changes.

```bash
# Parse all files
kodus-graph parse --all --repo-dir . --out graph.json

# Parse specific files
kodus-graph parse --files src/auth.ts src/db.ts --repo-dir . --out graph.json

# With glob filters
kodus-graph parse --all --repo-dir . --out graph.json \
  --include "src/**/*.ts" \
  --exclude "**/*.test.ts" "**/*.spec.ts"

# Limit memory usage (useful in CI/sandbox environments)
kodus-graph parse --all --repo-dir . --out graph.json --max-memory 512
```

**Output:** JSON with `metadata`, `nodes`, and `edges`. See [example output](examples/parse-output.json).

### `analyze`

Computes the impact of code changes — how far the blast radius reaches, how risky the change is (4-factor score), and which changed functions lack tests.

**When to use:** During code review or CI, to assess the risk of a PR before merging.

```bash
kodus-graph analyze \
  --files src/auth.ts src/user.service.ts \
  --graph graph.json \
  --out analysis.json
```

**Output:** `blast_radius`, `risk_score` (level + factors), `test_gaps`. See [example output](examples/analyze-output.json).

### `context`

Generates enriched review context for AI agents — caller/callee chains, affected execution flows, inheritance, risk assessment, and test coverage per changed function.

**When to use:** Feed this to an LLM-based code reviewer so it understands the full impact of a change, not just the diff.

```bash
# JSON format (for programmatic use)
kodus-graph context \
  --files src/auth.ts \
  --graph graph.json \
  --out context.json \
  --format json

# Prompt format (for LLM agents)
kodus-graph context \
  --files src/auth.ts \
  --graph graph.json \
  --out context.txt \
  --format prompt \
  --min-confidence 0.5 \
  --max-depth 3 \
  --max-functions 50 \
  --max-prompt-chars 80000
```

**Output:** Enriched functions with callers, callees, affected flows, risk level. See [example output](examples/context-output.json).

### `diff`

Detects structural changes between the current code and a previous graph — which nodes/edges were added, removed, or modified (signature, body, line range).

**When to use:** To understand what actually changed structurally in a PR, beyond the raw text diff.

```bash
# Diff against a git ref
kodus-graph diff --base main --graph graph.json --out diff.json

# Diff specific files
kodus-graph diff --files src/auth.ts --graph graph.json --out diff.json
```

**Output:** Added/removed/modified nodes and edges with detail on what changed.

### `update`

Incrementally updates an existing graph — only re-parses files whose content hash changed. Much faster than a full parse on large repos.

**When to use:** After each commit or PR merge to keep the baseline graph up to date without re-parsing the entire codebase.

```bash
kodus-graph update --repo-dir . --graph graph.json
```

### `communities`

Groups code into module clusters based on directory structure and detects coupling between them (how many cross-cluster calls exist).

**When to use:** To understand the modular architecture of a codebase and identify tightly coupled areas that may need refactoring.

```bash
kodus-graph communities --graph graph.json --out communities.json --min-size 2 --depth 2
```

### `flows`

Detects entry points (HTTP handlers, test functions) and traces their execution paths through the call graph.

**When to use:** To understand which user-facing flows are affected by a code change — e.g., "this change breaks the login flow".

```bash
kodus-graph flows --graph graph.json --out flows.json --max-depth 10 --type all
```

### `search`

Queries the graph by name, kind, file path, or call relationships. Supports glob patterns and regex.

**When to use:** To explore the graph interactively — find all callers of a function, list all methods in a service, etc.

```bash
# Search by name (glob or regex)
kodus-graph search --graph graph.json --query "auth*"
kodus-graph search --graph graph.json --query "/^handle.*Request$/"

# Filter by kind
kodus-graph search --graph graph.json --query "*" --kind Method --file "src/services/*"

# Find callers/callees
kodus-graph search --graph graph.json --callers-of "src/db.ts::query"
kodus-graph search --graph graph.json --callees-of "src/auth.ts::authenticate"
```

## Graph Schema

### Nodes

| Field | Type | Description |
|---|---|---|
| `kind` | `NodeKind` | Function, Method, Constructor, Class, Interface, Enum, Test |
| `name` | `string` | Symbol name |
| `qualified_name` | `string` | Unique ID: `file::Class.method` |
| `file_path` | `string` | Relative file path |
| `line_start` / `line_end` | `number` | Source location |
| `language` | `string` | Source language |
| `is_test` | `boolean` | Whether it's a test function |
| `is_exported` | `boolean` | Whether the function/class is publicly accessible |
| `is_async` | `boolean` | Whether the function is async |
| `decorators` | `string[]` | Annotations/decorators (e.g., `@Injectable`, `@Test`) |
| `throws` | `string[]` | Exception types thrown by the function |

### Edges

| Field | Type | Description |
|---|---|---|
| `kind` | `EdgeKind` | CALLS, IMPORTS, INHERITS, IMPLEMENTS, TESTED_BY, CONTAINS |
| `source_qualified` | `string` | Caller/parent node |
| `target_qualified` | `string` | Callee/child node |
| `confidence` | `number` | 0.0–1.0 (for CALLS edges) |

### Confidence Levels

| Source | Confidence | Description |
|---|---|---|
| DI injection | 0.90–0.95 | Constructor/property injection patterns |
| Same file | 0.85 | Call within the same file |
| Import resolved | 0.70–0.90 | Cross-file call via import |
| Unique match | 0.50 | Only one candidate across codebase |
| Ambiguous | 0.30 | Multiple candidates found |

## Examples

The `examples/` directory contains real output from running kodus-graph on a sample TypeScript project:

| File | Command | Description |
|---|---|---|
| [`parse-output.json`](examples/parse-output.json) | `parse --all` | Full graph with 17 nodes, 21 edges |
| [`analyze-output.json`](examples/analyze-output.json) | `analyze --files src/auth.ts` | Blast radius, risk score, test gaps |
| [`context-output.json`](examples/context-output.json) | `context --files src/auth.ts` | Enriched review context for AI agents |

## Architecture

```
Source Code → Parser → Resolver → Graph → Analysis
```

| Layer | Path | Responsibility |
|---|---|---|
| **Parser** | `src/parser/` | AST extraction via ast-grep; composable per-language extractors (one file per language) |
| **Resolver** | `src/resolver/` | Import resolution (tsconfig, workspaces, aliases), call resolution, symbol table, external package detection |
| **Graph** | `src/graph/` | Node/edge building, incremental merging, contract diffs, filesystem existence cache |
| **Analysis** | `src/analysis/` | Function-level blast radius, risk score, test gaps, flows, context |

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun run dev parse --all --repo-dir ./my-project --out graph.json

# Run tests
bun test

# Full check (typecheck + lint + tests)
bun run check

# Lint & format
bun run lint:fix
bun run format
```

## License

MIT
