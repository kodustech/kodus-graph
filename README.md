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

### Piping with `--out -`

Every command accepts `--out -` to write its output to stdout instead of a file.
Info/progress logs go to stderr, so stdout stays clean for Unix pipes:

```bash
# Pipe the prompt context straight into an AI review tool
kodus-graph context \
  --files src/auth.ts \
  --graph graph.json \
  --format prompt \
  --out - | ai-review-tool

# Filter graph output with jq without touching the disk
kodus-graph parse --all --repo-dir . --out - | jq '.nodes | length'
```

### Library Usage

`@kodus/kodus-graph` is also importable as a library for programmatic use:

```typescript
import { executeParse, executeContext, type GraphData } from '@kodus/kodus-graph';

// Parse a repo programmatically
await executeParse({
    repoDir: '.',
    all: true,
    out: 'graph.json',
});

// Generate review context
await executeContext({
    repoDir: '.',
    files: ['src/auth.ts'],
    graph: 'graph.json',
    out: 'context.txt',
    format: 'prompt',
    minConfidence: 0.5,
    maxDepth: 3,
});

// Or use stdout mode for piping / in-memory capture
await executeContext({
    repoDir: '.',
    files: ['src/auth.ts'],
    graph: 'graph.json',
    out: '-', // writes to process.stdout
    format: 'prompt',
    minConfidence: 0.5,
    maxDepth: 3,
});
```

The library exports all `execute*` command handlers, core types
(`GraphData`, `GraphNode`, `GraphEdge`, `ParseOutput`, `AnalysisOutput`, etc.),
utilities (`loadGraph`, `mergeGraphs`), and Zod schemas
(`graphDataSchema`, `graphNodeSchema`, `graphEdgeSchema`).

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

#### `metadata.tier_distribution` (optional)

Per-tier counts of call-resolver outcomes across the parse run. Useful for
calibrating trust per-repo — statically-typed languages produce higher-
confidence edges (`receiver`, `di`, `same`, `import`); dynamic languages skew
toward `ambiguous` and `noise`.

~~~bash
kodus-graph parse --all --repo-dir . --out - | jq '.metadata.tier_distribution'
# {
#   "receiver": 12,
#   "di": 34,
#   "same": 189,
#   "import": 72,
#   "unique": 21,
#   "ambiguous": 8,
#   "noise": 41,
#   "ambiguousNoise": 3
# }
~~~

In incremental updates (`kodus-graph update`) `tier_distribution` reflects only
the re-parsed slice (changed + added files), not the merged full graph.
Re-run `kodus-graph parse --all` for a whole-repo snapshot.

## Workflows

### Full Repository Analysis (first time)

```bash
# 1. Parse entire codebase
kodus-graph parse --all --repo-dir . --out graph.json

# 2. Analyze specific changed files
kodus-graph analyze --files src/auth.ts src/user.ts --graph graph.json --out analysis.json

# 3. Generate review context for AI agent
kodus-graph context --files src/auth.ts src/user.ts --graph graph.json --out context.txt --format prompt
```

### Incremental Updates (subsequent runs)

```bash
# Only re-parse changed files (fast)
kodus-graph update --repo-dir . --graph graph.json

# Then analyze/context as needed
kodus-graph context --files src/auth.ts --graph graph.json --out context.txt --format prompt
```

### CI/CD Integration

```bash
# In your CI pipeline (GitHub Actions, GitLab CI, etc.)
# 1. Parse the PR branch
kodus-graph parse --all --repo-dir . --out head-graph.json --max-memory 512

# 2. Generate context for changed files
kodus-graph context \
  --files $(git diff --name-only main...HEAD) \
  --graph head-graph.json \
  --out review-context.txt \
  --format prompt \
  --min-confidence 0.5

# 3. Feed to AI reviewer
cat review-context.txt | your-ai-review-tool
```

### Exploring a Codebase

```bash
# Find all methods in a service
kodus-graph search --graph graph.json --query "*Service*" --kind Method

# Who calls this function?
kodus-graph search --graph graph.json --callers-of "src/db.ts::query"

# What does this function call?
kodus-graph search --graph graph.json --callees-of "src/auth.ts::authenticate"

# Detect module boundaries and coupling
kodus-graph communities --graph graph.json --out modules.json

# Trace execution flows
kodus-graph flows --graph graph.json --out flows.json --type http
```

## Agent Integration

kodus-graph generates structured context that AI agents use for code review. Here are integration patterns for different agent frameworks.

### Claude Code (via shell)

```bash
# In a Claude Code session — generate context for files you're reviewing
! kodus-graph parse --all --repo-dir . --out /tmp/graph.json
! kodus-graph context --files src/auth.ts --graph /tmp/graph.json --format prompt --out /tmp/context.txt

# Then ask Claude to review with the context
cat /tmp/context.txt
# "Review this code change considering the context above"
```

### Claude Code Skill

Create a skill that auto-generates review context:

```bash
# .claude/skills/kodus-review.md
# When user asks to review code, run:
# 1. kodus-graph parse --all --repo-dir . --out /tmp/kg.json --max-memory 512
# 2. kodus-graph context --files <changed-files> --graph /tmp/kg.json --format prompt --out /tmp/ctx.txt
# 3. Read /tmp/ctx.txt and use it as review context
```

### Anthropic Claude API (TypeScript)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// 1. Generate graph context
execSync('kodus-graph parse --all --repo-dir . --out /tmp/graph.json');
execSync('kodus-graph context --files src/auth.ts --graph /tmp/graph.json --format prompt --out /tmp/context.txt');

const reviewContext = readFileSync('/tmp/context.txt', 'utf-8');
const diff = execSync('git diff main -- src/auth.ts').toString();

// 2. Send to Claude with structural context
const client = new Anthropic();
const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are a code reviewer. Use the structural context below to understand the full impact of changes.

${reviewContext}`,
    messages: [{
        role: 'user',
        content: `Review this diff:\n\n${diff}`
    }]
});
```

### OpenAI Agents SDK

```typescript
import { Agent, Runner } from 'openai-agents';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const reviewAgent = new Agent({
    name: 'CodeReviewer',
    instructions: (ctx) => {
        // Generate fresh context for each review
        execSync(`kodus-graph context --files ${ctx.files.join(' ')} --graph graph.json --format prompt --out /tmp/ctx.txt`);
        const graphContext = readFileSync('/tmp/ctx.txt', 'utf-8');
        return `You are a code reviewer with deep structural understanding.\n\n${graphContext}`;
    },
    model: 'gpt-4o',
});
```

### Python (subprocess)

```python
import subprocess
import json

# Parse repository
subprocess.run(["kodus-graph", "parse", "--all", "--repo-dir", ".", "--out", "graph.json"], check=True)

# Get context for changed files
result = subprocess.run(
    ["kodus-graph", "context", "--files", "src/auth.py", "--graph", "graph.json", "--format", "json", "--out", "/dev/stdout"],
    capture_output=True, text=True
)
context = json.loads(result.stdout)

# Use in your agent
blast_radius = context["analysis"]["blast_radius"]
risk_level = context["analysis"]["risk_score"]["level"]
print(f"Risk: {risk_level}, Blast radius: {blast_radius['total_functions']} functions")
```

### Using the JSON Output Programmatically

```typescript
import { readFileSync } from 'fs';

// Load graph
const graph = JSON.parse(readFileSync('graph.json', 'utf-8'));

// Find all async exported functions that throw
const riskyFunctions = graph.nodes.filter(n =>
    n.is_exported && n.is_async && n.throws?.length > 0
);

// Find functions with most callers (highest blast radius potential)
const callerCount = new Map<string, number>();
for (const edge of graph.edges) {
    if (edge.kind === 'CALLS') {
        callerCount.set(edge.target_qualified, (callerCount.get(edge.target_qualified) || 0) + 1);
    }
}
const hotspots = [...callerCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

console.log('Top 10 most-called functions:', hotspots);
```

### What the Agent Receives (prompt format)

When you use `--format prompt`, the output looks like:

```
=== Code Review Context ===

Risk Level: MEDIUM (score: 0.45)
Blast Radius: 12 functions across 5 files

--- Changed Functions ---

1. src/auth.ts::authenticate
   Status: modified
     Changes: params, return_type, is_async
     - params: (username: string) -> (username: string, options?: AuthOptions)
     - return_type: Promise<User> -> Promise<User | null>
     - is_async: false -> true
     Impact: 5 callers must add await (sync->async)
   Callers: [login, middleware.verify, api.handleAuth, ...]
   Callees: [db.findUser, crypto.hash, ...]
   Test coverage: YES (auth.test.ts)

--- Blast Radius ---
Depth 1: login, middleware.verify, api.handleAuth
Depth 2: router.post, app.listen
...
```

This gives the AI agent full understanding of:
- **What changed** (not just the diff, but structural changes)
- **Who's affected** (callers, callees, execution flows)
- **How risky** (risk score, test coverage, blast radius)
- **What broke** (contract diffs: params changed, async changed)

## Best Practices

### Parse Configuration

| Flag | Recommended | Why |
|------|-------------|-----|
| `--max-memory 512` | CI/sandbox | Prevents OOM in constrained environments (default 768MB) |
| `--skip-tests` | Large repos | Reduces noise — test nodes and TESTED_BY edges are skipped |
| `--exclude "**/*.test.ts" "**/node_modules/**"` | Always | Don't parse test files or dependencies |

### Context Configuration

| Flag | Recommended | Why |
|------|-------------|-----|
| `--min-confidence 0.5` | Default | Filters out ambiguous calls (0.30 confidence) from blast radius |
| `--max-depth 3` | Default | 3 levels of callers is usually enough; deeper adds noise |
| `--max-functions 30` | Prompt format | Limits LLM context size |
| `--max-prompt-chars 20000` | Prompt format | Prevents token overflow |
| `--format prompt` | For LLMs | Generates human-readable text instead of JSON |

### When to Re-parse

| Scenario | Command |
|----------|---------|
| First time | `parse --all` |
| After merging a PR | `update` (incremental) |
| After major refactor | `parse --all` (full rebuild) |
| Graph feels stale/wrong | `parse --all` (full rebuild) |
| Only changed files matter | `parse --files <changed>` |

### Interpreting Risk Scores

| Level | Score Range | What it means |
|-------|:-----------:|---------------|
| LOW | 0.0-0.3 | Small change, well-tested, limited blast radius |
| MEDIUM | 0.3-0.6 | Moderate impact, some test gaps or moderate blast radius |
| HIGH | 0.6-1.0 | Wide blast radius, missing tests, or inheritance chain affected |

The score is computed from 4 factors (defaults — override via `--risk-config`):
- **blast_radius** (35%) — how many functions are affected
- **test_gaps** (30%) — how many changed functions lack tests
- **complexity** (20%) — average lines-of-code in changed functions (switches to cyclomatic complexity in a later release)
- **inheritance** (15%) — whether class hierarchy is affected

## Examples

The `examples/` directory contains real output from running kodus-graph on a sample TypeScript project:

| File | Command | Description |
|---|---|---|
| [`parse-output.json`](examples/parse-output.json) | `parse --all` | Full graph with nodes, edges, and new fields |
| [`analyze-output.json`](examples/analyze-output.json) | `analyze --files src/auth.ts` | Blast radius, risk score, test gaps |
| [`context-output.json`](examples/context-output.json) | `context --format json` | Enriched review context (JSON) |
| [`context-prompt-output.txt`](examples/context-prompt-output.txt) | `context --format prompt` | Review context formatted for LLM agents |
| [`diff-output.json`](examples/diff-output.json) | `diff --files src/auth.ts` | Structural diff with contract diffs |
| [`search-output.json`](examples/search-output.json) | `search --query "auth*"` | Graph search results |
| [`flows-output.json`](examples/flows-output.json) | `flows` | Execution flow traces |
| [`communities-output.json`](examples/communities-output.json) | `communities` | Module clustering |

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
