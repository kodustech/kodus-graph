# AGENTS.md

Guidelines for AI agents and contributors working on this codebase.

## Project Overview

`@kodus/kodus-graph` is a CLI tool that parses source code into structural graphs for code review. It supports 8 languages via ast-grep and produces JSON output consumed by Kodus AI review agents.

## Tech Stack

- **Runtime:** Bun >= 1.3.0
- **Language:** TypeScript (strict mode)
- **Test runner:** bun:test
- **Linter/Formatter:** Biome
- **CLI framework:** Commander.js
- **AST engine:** ast-grep/napi

## Commands

```bash
bun run dev          # Run CLI in dev mode (TS directly)
bun test             # Run tests
bun run check        # Full check: typecheck + lint + tests
bun run lint:fix     # Fix lint issues
bun run format       # Format all files
bun run build:dist   # Compile TS → JS for npm publishing
bun run build        # Compile standalone binary
```

## Project Structure

```
src/
├── cli.ts              # CLI entry point (Commander.js)
├── commands/           # Command handlers (parse, analyze, context, diff, etc.)
├── parser/             # AST extraction per language
│   ├── batch.ts        # Async batch processing (50 files at a time)
│   ├── extractor.ts    # Language-agnostic extraction coordinator
│   ├── extractors/     # Language-specific extractors (typescript, python, ruby, etc.)
│   ├── discovery.ts    # File discovery with glob filtering
│   └── languages.ts    # Language registration and AST node kind mappings
├── resolver/           # Relationship resolution
│   ├── call-resolver.ts    # 5-tier confidence call resolution
│   ├── import-resolver.ts  # Module path resolution
│   ├── symbol-table.ts     # Qualified name tracking
│   └── languages/          # Language-specific resolution rules
├── graph/              # Graph construction and I/O
│   ├── builder.ts      # RawGraph → GraphNode/GraphEdge
│   ├── edges.ts        # Edge derivation (INHERITS, CONTAINS, etc.)
│   ├── merger.ts       # Incremental graph merging
│   ├── loader.ts       # Graph loading with O(1) index
│   ├── json-writer.ts  # Streaming JSON output
│   └── types.ts        # All type definitions
├── analysis/           # Analysis and metrics
│   ├── blast-radius.ts # BFS call chain impact
│   ├── risk-score.ts   # 4-factor risk computation
│   ├── test-gaps.ts    # Untested function detection
│   ├── context-builder.ts  # Enriched review context (V2)
│   ├── flows.ts        # Execution flow tracing
│   └── ...
└── shared/             # Utilities (logger, filters, hashing, schemas)

tests/                  # Mirrors src/ structure
tests/fixtures/         # Sample repos for testing
```

## Coding Standards

### TypeScript

- **Strict mode** is enabled — no implicit any, no unused locals
- **`isolatedModules: true`** — every file must be independently transpilable
- Use `import type` for type-only imports
- Prefer `interface` over `type` for object shapes
- No Bun-specific APIs in `src/` (except `Bun.Glob` in discovery.ts which is being migrated)

### Formatting (Biome)

- **Indent:** 4 spaces
- **Quotes:** single quotes
- **Semicolons:** always
- **Trailing commas:** all
- **Block statements:** always use `{}` — never `if (x) return;`

```typescript
// Wrong
if (condition) return;
for (const item of list) doSomething(item);

// Correct
if (condition) {
    return;
}
for (const item of list) {
    doSomething(item);
}
```

### Linting Rules

- `noUnusedImports: error` — remove unused imports
- `noUnusedVariables: warn` — prefix unused vars with `_`
- `noExplicitAny: off` — any is allowed when needed
- `noForEach: off` — forEach is allowed

### Naming

- **Files:** kebab-case (`call-resolver.ts`, `blast-radius.ts`)
- **Types/Interfaces:** PascalCase (`GraphNode`, `RawCallEdge`)
- **Functions/variables:** camelCase (`buildGraphData`, `resolveAllCalls`)
- **Qualified names:** `file_path::ClassName.methodName` format

### Testing

- Use `bun:test` (`describe`, `it`, `expect`)
- Test files mirror src structure: `src/graph/builder.ts` → `tests/graph/builder.test.ts`
- Fixtures go in `tests/fixtures/`
- Use `!` non-null assertion in tests for known state (e.g., `result[0]!.name`)

### Architecture Patterns

- **Pipeline:** Parser → Resolver → Graph → Analysis (data flows one direction)
- **RawGraph** is the internal intermediate representation; **GraphData** is the final output
- **Qualified names** are the universal key for cross-referencing nodes/edges
- **Confidence scores** on CALLS edges (0.0–1.0) — never hardcode, use the resolver
- **Streaming JSON** for output — use `json-writer.ts`, don't `JSON.stringify` large graphs
- **Content hashing** for incremental parsing — always set `content_hash` on nodes

### Adding a New Language

1. Create extractor in `src/parser/extractors/{lang}.ts`
2. Add AST node kind mappings in `src/parser/languages.ts`
3. Add resolution rules in `src/resolver/languages/{lang}.ts`
4. Register the language in `src/parser/languages.ts`
5. Add test fixtures in `tests/fixtures/`

### Common Pitfalls

- **Don't import from `bun:`** in src/ — keep Node-compatible
- **Don't use `JSON.stringify`** for graph output — use `writeGraphJSON` for streaming
- **Don't assume file extensions** — use the language registry for detection
- **Always use qualified names** for node identity, never just the symbol name
- **Call resolver confidence tiers matter** — DI (0.90+) > same-file (0.85) > import (0.70) > unique (0.50) > ambiguous (0.30)

## Pull Request Checklist

- [ ] `bun run check` passes (typecheck + lint + tests)
- [ ] New code follows block statement rule (always `{}`)
- [ ] New features have tests
- [ ] No source maps or sensitive data in published files
- [ ] Qualified name format is consistent (`file::Class.method`)
