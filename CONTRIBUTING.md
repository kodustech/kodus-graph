# Contributing to kodus-graph

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- [Git](https://git-scm.com)

### Setup

```bash
git clone https://github.com/kodustech/kodus-graph.git
cd kodus-graph
bun install
```

### Verify your setup

```bash
bun run check
```

This runs typecheck + lint + tests. All three must pass before submitting a PR.

## Development Workflow

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feat/my-feature`
3. **Make your changes**
4. **Run checks**: `bun run check`
5. **Commit** with a clear message
6. **Open a PR** against `main`

### Useful Commands

| Command | Description |
|---|---|
| `bun run dev` | Run CLI in dev mode (TS directly) |
| `bun test` | Run tests |
| `bun run check` | Full check: typecheck + lint + tests |
| `bun run lint:fix` | Fix lint issues |
| `bun run format` | Format all files |

## Code Standards

See [AGENTS.md](AGENTS.md) for detailed coding standards. Key points:

- **Formatting:** Biome with 4-space indent, single quotes, always semicolons
- **Block statements:** Always use `{}` for `if`, `for`, `while` — no single-line bodies
- **Tests:** Every new feature needs tests. Test files mirror the `src/` structure
- **Types:** Use `interface` over `type` for object shapes. Use `import type` for type-only imports

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add Ruby class extraction support
fix: resolve false positive calls in nested functions
refactor: simplify call-resolver confidence logic
docs: update README with search command examples
test: add edge cases for DI pattern detection
```

Prefixes: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.

## Adding Language Support

To add support for a new language:

1. Create the directory `src/languages/{lang}/` with:
   - `extractor.ts` (implements `LanguageExtractors`, registers via `registerExtractor`)
   - `resolver.ts` (module path resolver, or a re-export from another language)
   - `external.ts` (exports `detect(modulePath, repoRoot)`)
   - `index.ts` (barrel that imports `./extractor` and re-exports `resolve` + `detect`)
2. Register AST node kind mappings in `src/parser/languages.ts`
3. Register the resolver in `src/resolver/import-resolver.ts`
4. Register the detector in `src/resolver/external-detector.ts`
5. Add test fixtures in `tests/fixtures/`
6. Add tests in `tests/parser/` and `tests/resolver/`

Look at an existing language (e.g. `src/languages/typescript/` or `src/languages/python/`) as a reference.

## Reporting Issues

- Use [GitHub Issues](https://github.com/kodustech/kodus-graph/issues)
- Include Bun version (`bun --version`), OS, and steps to reproduce
- For parsing bugs, include a minimal code sample that triggers the issue

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
