# @kodus/kodus-graph

[![npm version](https://img.shields.io/npm/v/@kodus/kodus-graph)](https://www.npmjs.com/package/@kodus/kodus-graph)
[![license](https://img.shields.io/npm/l/@kodus/kodus-graph)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-%23f9f1e1)](https://bun.sh)

**Give an AI code reviewer the structure a human reviewer already has.**

An LLM handed a raw diff sees changed lines. It doesn't see who calls the function you touched, that the signature change breaks five callers, or that nothing tests it — so it guesses, and the guesses are the noise. kodus-graph parses your codebase into a structural graph and answers those questions first, then hands the model a context block instead.

```bash
kodus-graph parse --all --repo-dir . --out graph.json
kodus-graph context --files src/auth.ts --graph graph.json --diff pr.diff --format prompt --out -
```

```
1 changed (0 untested) | 3 impacted | 2 files | risk MEDIUM 0.41

CHANGED:
  verifyToken(token: string, opts: VerifyOpts) -> Promise<boolean> [src/auth.ts:16-18] modified | 1 callers | tested
    ⚠ params: (token: string) → (token: string, opts: VerifyOpts)
    ⚠ return_type: boolean → Promise<boolean>
    ⚠ 1 callers may need param update; 1 callers may assume old return type
    ← verifyToken returns true for non-empty [tests/auth.test.ts:10]
    flow: TEST verifyToken returns true for non-empty → AuthService.verifyToken

BLAST RADIUS:
  depth 1 [contract_breaking]: verifyToken returns true for non-empty (95%, score 0.13) (1)
    ⚠ callers may need update (contract changed)
```

Real output, reproducible with [`scripts/generate-examples.sh`](scripts/generate-examples.sh) — see [`examples/`](#examples) for every command's.

16 languages. Deterministic — there is no model in the parse path, so the graph is the same every run. Standalone CLI and library: it powers review at [Kodus](https://kodus.io), but nothing here is coupled to it.

## Features

- **Multi-language support.** 16 languages with consistent core extraction (TypeScript/Tsx/JavaScript share an extractor): TypeScript, Python, Go, Java, Kotlin, Rust, C++, Scala, C#, Swift, Dart, Elixir, Ruby, PHP, C, Bash. Each has a declared support tier (🟢 full / 🟡 basic / 🔴 experimental) with per-language baselines enforced in CI. See the [language support matrix](docs/language-support-matrix.md) for capability depth and validation status.
- **Structural graph** — Functions, methods, constructors, classes, interfaces, enums, tests as nodes; CALLS, IMPORTS, INHERITS, IMPLEMENTS, TESTED_BY, CONTAINS, USES_TYPE as edges. Each node carries `is_exported`, `is_async`, `decorators`, `throws`, `complexity`.
- **5-tier call resolver** — `receiver` (0.95/0.90) → `noise` filter → `di` (0.90/0.95) → `class` (0.85/0.90) → `cascade` (same/import/unique/ambiguous, 0.85→0.30). Each CALLS edge records its tier and confidence.
- **Receiver-type inference** — From `new Foo()`, typed parameters, type cast `as Foo`, factory deferred (`const x = factory()` resolved cross-file via the `@CALLEE:` mechanism), method-chain return type, and singleton patterns (`Foo.getInstance()`).
- **Inheritance-aware lookup** — When `Foo.method` isn't directly indexed but Foo extends Bar (or implements an interface) where the method exists, walks the hierarchy with cycle protection.
- **DI detection** — Java/Kotlin: `@Inject`/`@Autowired`/`@Resource` on fields and constructors. Java implicit ctor injection covers Spring 4.3+ stereotypes (`@Service`, `@Component`, `@Repository`, `@Controller`, `@RestController`, `@Configuration`), CDI/Jakarta (`@ApplicationScoped`, `@RequestScoped`, etc.), EJB (`@Stateless`, etc.), JAX-RS (`@Path`, `@Provider`). Bare typed fields (`private final Foo foo;`) also feed the DI map.
- **Kotlin extension functions** — `fun Foo.bar()` is indexed as `Foo.bar`, so `foo.bar()` resolves at the receiver tier.
- **JSX/TSX components as calls** — `<UserCard />` becomes a CALLS edge to the component function/class.
- **Contract diffs** — Detects changes to params, return types, modifiers, async, and decorators (not just body edits).
- **Function-level blast radius** — Impact analysis per function, not per file. Log-scaled: 0 callers vs 1 is the jump that decides a review, and it reads as one.
- **Type dependencies are edges** — `checkout(o: Order)` calls nothing in `types.ts`, so a call graph alone reports a blast radius of zero when `Order` changes. `USES_TYPE` links a signature to the repo types it names, so changing an interface shows who breaks.
- **Call-based test coverage** — `TESTED_BY` comes from a test **calling** a symbol, recorded per symbol. Importing a file does not make it tested; a filename match is the fallback only for languages whose test calls don't resolve.
- **Confidence reaches the consumer** — Every caller carries the `tier` and `confidence` it was resolved with, so a 0.95 receiver-typed edge and a 0.60 name guess don't read as the same claim. Output also states its own limits: absence from the graph is not absence from the codebase.
- **Smart import resolution** — tsconfig extends/rootDirs/project references, monorepo workspace exports, package.json `#imports`, Webpack/Vite aliases, Go workspaces/vendor, Maven/Gradle multi-module (with test source roots and `<sourceDirectory>` overrides), Cargo workspace path deps.
- **External package detection** — Distinguishes internal code from npm, pip, Maven, Cargo, etc.
- **Composable extractors** — Per-language extractor files behind generic `createLanguageRegistry<T>()` factory; same shape for extractors, noise, DI heuristics, capabilities, receiver-types.
- **Incremental parsing + merge** — `update` re-parses only files whose content hash changed, then merges; `tier_distribution` is recomputed from the merged graph (each edge persists its tier).
- **Streaming JSON** — Memory-efficient output for large codebases.

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

### `pr-overlap`

Compares two changesets (PRs) for merge risk — which symbols they both touch and where each PR's blast radius lands in the other's.

**When to use:** Before merging concurrent PRs, to catch collisions that neither review would see reviewing its PR in isolation.

```bash
# Compare two PRs by their changed files (symbols expanded automatically)
kodus-graph pr-overlap \
  --graph graph.json \
  --a-files src/auth.ts \
  --b-files src/user.service.ts \
  --out overlap.json

# Or pass qualified symbols directly
kodus-graph pr-overlap --graph graph.json \
  --a "src/auth.ts::verifyToken" \
  --b "src/db.ts::query" \
  --out overlap.json
```

One of `--a` / `--a-files` and one of `--b` / `--b-files` is required. Optional: `--max-depth`, `--min-confidence`.

### `subsystem-context`

Orients a changeset — which module(s) it belongs to, its hub/bridge role in the call graph, and its immediate callers and callees.

**When to use:** To learn where a change lives architecturally before reviewing it, instead of reconstructing the structure by hand.

```bash
kodus-graph subsystem-context \
  --graph graph.json \
  --files src/auth.ts \
  --out subsystem.json
```

One of `--changed` (qualified symbols) or `--files` is required. Optional: `--top`, `--min-size`.

### `context-of`

Builds a single symbol's context pack — its callers, callees, types it uses, and tests — ranked by connectivity, in one query.

**When to use:** To understand a symbol before editing it, instead of grepping its name across the repo.

```bash
kodus-graph context-of \
  --graph graph.json \
  --symbol "src/auth.ts::verifyToken" \
  --out context-of.json \
  --limit 15
```

### `path`

Finds the shortest call path between two symbols — "how does A reach B?".

**When to use:** To see how one symbol reaches another, instead of chaining greps and guessing the links.

```bash
kodus-graph path \
  --graph graph.json \
  --from "src/api.ts::handleLogin" \
  --to "src/db.ts::query" \
  --out path.json

# Count other edge kinds as hops (default: CALLS)
kodus-graph path --graph graph.json \
  --from "src/api.ts::handleLogin" --to "src/db.ts::query" \
  --kinds CALLS IMPORTS --max-depth 10 --out path.json
```

### `rank`

Ranks symbols by structural importance (degree) for relevance-ordered retrieval.

**When to use:** To find the load-bearing symbols to read first, instead of opening files in arbitrary order.

```bash
# Top 20 most-connected symbols in the graph
kodus-graph rank --graph graph.json --out rank.json --top 20

# Restrict to a file or a node kind
kodus-graph rank --graph graph.json --out rank.json --file src/auth.ts --kind Function
```

### `status`

Checks whether the graph is still fresh against the repo's files on disk.

**When to use:** Before trusting any query — a stale graph answers confidently and wrongly.

```bash
kodus-graph status --graph graph.json --out - --repo-dir .
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

### `outline`

Prints a compact structural outline of files — every symbol with its signature, line range, and flags (`export`, `async`, `test`, cyclomatic `cx<n>`, decorators), with methods nested under their class. Parse-on-demand and **local-only** (no cross-file resolution, no graph file needed), so it's cheap to run on a single file.

**When to use:** To give an AI agent (or yourself) the structure of a file before reading the whole thing — the "table of contents before the full text" pattern. Pipe `--format json` into a tool, or read the text form directly.

```bash
# Text outline of specific files
kodus-graph outline --files src/auth.ts src/db.ts --repo-dir .

# Whole directory, exported symbols only
kodus-graph outline --dir ./src --exported-only

# Machine-readable JSON for an agent / pipe
kodus-graph outline --files src/auth.ts --format json --out - | jq '.[0].symbols'

# Enrich with cross-file impact from an existing graph: CALLS fan-in/fan-out
# (and blast-radius size with --blast). This is what a purely syntactic
# outline (e.g. ast-grep's) can't do.
kodus-graph outline --files src/db.ts --graph graph.json --blast
```

Example text output:

```
src/auth.ts
  interface AuthConfig  L2-5  [export]
  class AuthService  L7-19  [export]
      ctor AuthService.constructor(private readonly config: AuthConfig)  L8-8  [export]
      method authenticate(ctx: Context): Promise<Result>  L10-14  [export async cx2]
      method verifyToken(token: string): boolean  L16-18  [export]
  fn hashPassword(password: string): string  L21-23  [export]
  fn validateEmail(email: string): boolean  L25-27
```

With `--graph --blast`, each symbol also carries `↑<callers> ↓<callees>` (CALLS
fan-in / fan-out) and `⌀<n>` (blast-radius size — downstream functions impacted
if it changes):

```
src/db.ts
  fn findUser(id: number): Promise<User | null>  L0-2  [export async ↑3 ↓0 ⌀6]
  fn saveUser(user: User): Promise<void>  L4-4  [export async ↑2 ↓0 ⌀3]
```

## Graph Schema

A summary follows; see [`docs/SCHEMA.md`](docs/SCHEMA.md) for the full payload reference covering every command's input and output.

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
| `kind` | `EdgeKind` | CALLS, IMPORTS, INHERITS, IMPLEMENTS, TESTED_BY, CONTAINS, USES_TYPE |
| `source_qualified` | `string` | Caller/parent node |
| `target_qualified` | `string` | Callee/child node |
| `file_path` | `string` | File where the edge originates |
| `line` | `number` | Source line of the call |
| `confidence` | `number` | 0.0–1.0 (CALLS edges only) |
| `tier` | `EdgeTier` | Resolver tier that produced this edge: `receiver` / `di` / `same` / `import` / `unique` / `ambiguous` (CALLS only) |
| `alternatives` | `string[]` | Candidates considered but not picked, sorted (CALLS at the ambiguous tier) |

### Confidence Levels

The 5-tier resolver runs in priority order; the first tier that produces an outcome wins. Each edge records its `tier` and a numeric `confidence`:

| Tier | Confidence | When it fires |
|---|---|---|
| `receiver` | 0.95 / 0.90 / 0.85 | Receiver type known via local binding, typed param, factory chain, singleton, or inheritance walk |
| `di` | 0.95 / 0.90 | `this.field.method()` where field is in the DI map (annotated, ctor-injected, or bare typed) |
| `same` | 0.85 / 0.90 | Same-file declaration (also used by `self`/`super` class lookup) |
| `import` | 0.90 / 0.85 / 0.70 | Cross-file via import (high if symbol is in target file's symbol table; lower if only the import path is known) |
| `unique` | 0.60 / 0.50 | Only one candidate across the codebase (boost when same directory) |
| `ambiguous` | 0.30 | Multiple candidates; `alternatives[]` is populated, target is the closest by path proximity |

`noise` and `ambiguousNoise` are *drop* outcomes (no edge). They appear in `metadata.tier_distribution` but never on edges.

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
    model: 'claude-opus-4-8',
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

| Factor | Weight | What it measures | How it normalizes |
|---|:---:|---|---|
| **blast_radius** | 35% | How many functions the change reaches | `log1p(n) / log1p(caps.blast_functions)`, saturating at the cap. Log rather than linear: the jump from 0 callers to 1 is the one that decides a review; 40 vs 41 is not. |
| **test_gaps** | 30% | How many changed functions no test exercises | A function is tested when a test **calls** it — resolved per symbol, not inferred from an import. Languages whose test calls don't resolve fall back to a file-level filename match. |
| **complexity** | 20% | How gnarly the changed functions are | Cyclomatic complexity against `caps.cyclomatic` (10 — McCabe's per-function ceiling). Lines-of-code against `caps.lines_of_code` only for legacy graphs whose nodes carry no `complexity`. |
| **inheritance** | 15% | How much of the change sits in a class hierarchy | The share of changed symbols that extend or implement something, counting a method through its owning class. |

Weights must sum to 1.0. Caps are per-unit and independent:

```jsonc
{
  "weights": { "blast_radius": 0.35, "test_gaps": 0.3, "complexity": 0.2, "inheritance": 0.15 },
  "caps": {
    "blast_functions": 20,   // affected functions at which blast_radius saturates
    "cyclomatic": 10,        // decision points at which complexity saturates
    "lines_of_code": 50      // legacy fallback only — nodes with no complexity field
  }
}
```

The score orders attention; it is not a calibrated probability of defect. The
weights are defaults chosen by judgement, not fitted against outcome data.

## Examples

The `examples/` directory is real output from running kodus-graph on
[`tests/fixtures/sample-repo`](tests/fixtures/sample-repo), regenerated by
[`scripts/generate-examples.sh`](scripts/generate-examples.sh). The script parses
a baseline, changes `AuthService.verifyToken`'s signature, and asks for context —
the case the tool exists for: the signature moves, the callers don't, and only
the graph knows who breaks.

| File | Command | Description |
|---|---|---|
| [`parse-output.json`](examples/parse-output.json) | `parse --all` | Full graph — nodes, edges, per-edge tier and confidence |
| [`analyze-output.json`](examples/analyze-output.json) | `analyze --files src/auth.ts` | Blast radius, risk score, test gaps |
| [`context-output.json`](examples/context-output.json) | `context --format json` | Enriched review context (JSON) |
| [`context-prompt-output.txt`](examples/context-prompt-output.txt) | `context --format prompt` | Review context formatted for LLM agents |
| [`context-xml-output.xml`](examples/context-xml-output.xml) | `context --format xml` | Same, as XML — `<ReviewFocus>`, `<CriticalPaths>`, `<ContractDiff>` |
| [`diff-output.json`](examples/diff-output.json) | `diff --files src/auth.ts` | Structural diff with contract diffs |
| [`search-output.json`](examples/search-output.json) | `search --query "auth*"` | Graph search results |
| [`flows-output.json`](examples/flows-output.json) | `flows` | Execution flow traces |
| [`communities-output.json`](examples/communities-output.json) | `communities` | Module clustering |

Run the script after any change to output shape or scoring — these files are the
showcase, and they drift silently otherwise.

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
