# AGENTS.md

Guidelines for AI agents and contributors working on this codebase.

## Project Overview

`@kodus/kodus-graph` is a CLI tool that parses source code into structural graphs for code review. It supports **14 languages** via ast-grep and produces JSON output consumed by Kodus AI review agents.

**Supported languages:** TypeScript, JavaScript, Python, Ruby, Go, Java, Kotlin, Rust, C#, PHP, Swift, Dart, Scala, C/C++, Elixir.

## Tech Stack

- **Runtime:** Bun >= 1.3.0
- **Language:** TypeScript (strict mode)
- **Test runner:** bun:test
- **Linter/Formatter:** Biome
- **CLI framework:** Commander.js
- **AST engine:** ast-grep/napi
- **Schema validation:** Zod

## Commands

```bash
bun run dev          # Run CLI in dev mode (TS directly)
bun test             # Run tests (796+ tests)
bun run check        # Full check: typecheck + lint + tests
bun run lint:fix     # Fix lint issues
bun run format       # Format all files
bun run build:dist   # Compile TS → JS for npm publishing
bun run build        # Compile standalone binary
```

## Project Structure

```
src/
├── cli.ts              # CLI entry point (Commander.js) — 8 commands
├── commands/           # Command handlers (parse, analyze, context, diff, update, communities, flows, search)
├── parser/             # AST extraction coordination
│   ├── batch.ts        # Async batch processing with dynamic memory monitoring
│   ├── extractor.ts    # Dispatch coordinator → languages/engine.ts
│   ├── discovery.ts    # File discovery with glob filtering
│   └── languages.ts    # Language registration and extension mapping
├── languages/          # Co-located per-language modules (14 languages)
│   ├── spec.ts         # LanguageExtractors interface (contract)
│   ├── engine.ts       # Dispatch + Extracted* → Raw* conversion
│   ├── shared.ts       # Reusable helpers (isExported, isAsync, extractDecorators, etc.)
│   ├── external-shared.ts # Shared deps cache + manifest helpers
│   └── <lang>/         # One folder per language:
│       ├── extractor.ts   # AST → Extracted* DTOs (registers via registerExtractor)
│       ├── resolver.ts    # Module path resolution (kotlin/scala re-export java)
│       ├── external.ts    # External-package detection (stdlib + manifest matching)
│       └── index.ts       # Barrel: triggers extractor registration, re-exports resolver + detect
├── resolver/           # Relationship resolution (language-agnostic)
│   ├── call-resolver.ts      # 5-tier confidence call resolution
│   ├── import-resolver.ts    # Module path dispatcher (tsconfig, workspaces, aliases, etc.)
│   ├── symbol-table.ts       # Qualified name tracking (dual-index: by-file + global)
│   ├── import-map.ts         # Per-file symbol → source file mapping
│   ├── re-export-resolver.ts # Barrel/re-export following
│   ├── external-detector.ts  # Thin dispatcher → languages/<lang>/external.ts
│   └── fs-cache.ts           # Filesystem existence cache (shared across resolvers)
├── graph/              # Graph construction and I/O
│   ├── builder.ts      # RawGraph → GraphNode/GraphEdge (filters external edges)
│   ├── edges.ts        # Edge derivation (INHERITS, IMPLEMENTS, TESTED_BY, CONTAINS)
│   ├── merger.ts       # Incremental graph merging via content hashing
│   ├── loader.ts       # Graph loading with O(1) index
│   ├── json-writer.ts  # Streaming JSON output
│   └── types.ts        # All type definitions (Raw*, GraphNode, GraphEdge, etc.)
├── analysis/           # Analysis and metrics
│   ├── blast-radius.ts # Function-level BFS with confidence filter + is_exported check
│   ├── risk-score.ts   # 4-factor risk computation
│   ├── test-gaps.ts    # Untested function detection
│   ├── diff.ts         # Structural diff with contract diffs (params, return_type, is_async, decorators)
│   ├── enrich.ts       # Enriched functions with caller impact messages
│   ├── context-builder.ts  # Enriched review context (function-level, not file-level)
│   ├── prompt-formatter.ts # LLM-friendly text output with contract diffs
│   ├── flows.ts        # Execution flow tracing
│   └── ...
└── shared/             # Utilities (logger, filters, hashing, schemas)

tests/                  # Mirrors src/ structure (796+ tests)
tests/fixtures/         # Sample files per language (follow language naming conventions)
```

## Graph Schema

### Nodes (GraphNode)

| Field | Type | Description |
|---|---|---|
| `kind` | `NodeKind` | Function, Method, Constructor, Class, Interface, Enum, Test |
| `name` | `string` | Symbol name |
| `qualified_name` | `string` | Unique ID: `file::Class.method` |
| `file_path` | `string` | Relative file path |
| `line_start` / `line_end` | `number` | Source location |
| `language` | `string` | Source language |
| `is_test` | `boolean` | Whether it's a test function |
| `is_exported` | `boolean?` | Whether publicly accessible (public, export, pub, uppercase in Go) |
| `is_async` | `boolean?` | Whether the function is async |
| `decorators` | `string[]?` | Annotations/decorators (@Injectable, @Test, #[derive]) |
| `throws` | `string[]?` | Exception types thrown |
| `params` | `string?` | Function parameter text |
| `return_type` | `string?` | Return type text |
| `modifiers` | `string?` | Access modifiers (public, private, static, etc.) |
| `content_hash` | `string?` | SHA-256 hash for change detection |

### Edges (GraphEdge)

| Field | Type | Description |
|---|---|---|
| `kind` | `EdgeKind` | CALLS, IMPORTS, INHERITS, IMPLEMENTS, TESTED_BY, CONTAINS |
| `source_qualified` | `string` | Caller/parent node |
| `target_qualified` | `string` | Callee/child node |
| `confidence` | `number?` | 0.0–1.0 (for CALLS edges only) |

### Edge Quality Rules

- **IMPORTS**: Only emitted for resolved imports (external packages are filtered out)
- **CALLS**: Only emitted when target file exists in repo (no phantom edges)
- **INHERITS/IMPLEMENTS**: Only emitted when target is a local node (external classes skipped)
- **TESTED_BY**: File-to-file relationship (source file → test file)

## Coding Standards

### TypeScript

- **Strict mode** is enabled — no implicit any, no unused locals
- **`isolatedModules: true`** — every file must be independently transpilable
- Use `import type` for type-only imports
- Prefer `interface` over `type` for object shapes

### Formatting (Biome)

- **Indent:** 4 spaces
- **Quotes:** single quotes
- **Semicolons:** always
- **Trailing commas:** all
- **Block statements:** always use `{}` — never `if (x) return;`

### Naming

- **Files:** kebab-case (`call-resolver.ts`, `blast-radius.ts`)
- **Types/Interfaces:** PascalCase (`GraphNode`, `RawCallEdge`)
- **Functions/variables:** camelCase (`buildGraphData`, `resolveAllCalls`)
- **Qualified names:** `file_path::ClassName.methodName` format
- **Fixture files:** follow language conventions (snake_case for Go/Rust/Python/Dart/Elixir/C, PascalCase for Java/Kotlin/Swift/Scala/C#/PHP)

### Testing

- Use `bun:test` (`describe`, `it`/`test`, `expect`)
- Test files mirror src structure: `src/graph/builder.ts` → `tests/graph/builder.test.ts`
- Fixtures go in `tests/fixtures/<language>/`
- Schema validation via zod in `tests/graph/schema-validation.test.ts`
- CLI tests spawn processes in `tests/commands/cli.test.ts`

### Adding a New Language

1. Install lang pack: `bun add @ast-grep/lang-{name}`
2. Register in `src/parser/languages.ts` (import, registerDynamicLanguage, extension mapping)
3. Create `src/languages/{name}/` directory with these files:
   - `extractor.ts` — implements `LanguageExtractors`; must return `is_exported`, `is_async`, `decorators`, `throws`; register with `registerExtractor('{name}', extractors)` at the bottom
   - `resolver.ts` — module path resolution (or re-export another language's resolver, e.g. kotlin/scala re-export java)
   - `external.ts` — exports `detect(modulePath, repoRoot): string | null` for external-package detection
   - `index.ts` — barrel that does `import './extractor'` (to register) and re-exports `resolve` + `detect`
4. Add `import '../languages/{name}'` to `src/parser/extractor.ts`
5. Register the resolver in `src/resolver/import-resolver.ts` RESOLVERS map
6. Register the detect() in `src/resolver/external-detector.ts` DETECTORS map
7. Create fixture in `tests/fixtures/{name}/` (follow language naming convention)
8. Add extraction tests + new fields tests in `tests/parser/`
9. Add resolver tests in `tests/resolver/{name}.test.ts`

### Architecture Patterns

- **Pipeline:** Parser → Resolver → Graph → Analysis (data flows one direction)
- **Composable extractors:** Each language is a separate file implementing `LanguageExtractors`
- **Engine dispatch:** `engine.ts` routes to the right extractor and converts `Extracted*` → `Raw*`
- **Shared helpers:** `shared.ts` provides common functions (don't reimplement per language)
- **RawGraph** is the internal intermediate representation; **GraphData** is the final output
- **Qualified names** are the universal key for cross-referencing nodes/edges
- **Confidence scores** on CALLS edges (0.0–1.0) — never hardcode, use the resolver
- **External detection:** Resolver returns null for external packages; builder skips unresolved edges
- **Contract diffs:** Diff detects changes in params, return_type, modifiers, is_async, decorators
- **Function-level blast radius:** Seeds are changed qualified names, not file paths
- **Streaming JSON** for output — use `json-writer.ts`, don't `JSON.stringify` large graphs
- **Content hashing** for incremental parsing — always set `content_hash` on nodes
- **Memory resilience:** `--max-memory` flag, dynamic batch sizing, rawGraph incremental release

### Common Pitfalls

- **Don't import from `bun:`** in src/ — keep Node-compatible
- **Don't use `JSON.stringify`** for graph output — use `writeGraphJSON` for streaming
- **Don't assume file extensions** — use the language registry for detection
- **Always use qualified names** for node identity, never just the symbol name
- **Call resolver confidence tiers matter** — DI (0.90+) > same-file (0.85) > import (0.70) > unique (0.50) > ambiguous (0.30)
- **Don't emit edges to external packages** — builder filters them, don't bypass
- **Language routing uses exact lang strings** — TS uses `'TypeScript'`/`'Tsx'`/`'JavaScript'` (capital), others use lowercase

## Pull Request Checklist

- [ ] `bun run check` passes (typecheck + lint + tests)
- [ ] New code follows block statement rule (always `{}`)
- [ ] New features have tests (including new fields tests for new languages)
- [ ] No source maps or sensitive data in published files
- [ ] Qualified name format is consistent (`file::Class.method`)
- [ ] Fixture filenames follow language conventions
- [ ] AGENTS.md and README.md updated if adding language or feature
