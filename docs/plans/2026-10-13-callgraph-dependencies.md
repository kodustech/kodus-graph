# Call Graph Dependencies Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make the XML call graph name local dependencies of changed functions while preserving a bounded, deterministic review context.

**Architecture:** The graph already exposes enriched caller and callee references. The XML formatter will rank those references using graph node metadata, render bounded direct callees, and retain explicit truncation information. The context command forwards the callee limit to the XML formatter.

**Tech Stack:** TypeScript, Bun test, Commander, ast-grep graph output.

### Task 1: Lock the formatter contract with tests

**Files:**
- Modify: `tests/analysis/xml-formatter.test.ts`

1. Build context from a changed function, local dependencies, production callers, and a test caller.
2. Assert production callers win capped slots even if the test edge is encountered first.
3. Assert XML renders the highest-confidence direct dependency and an explicit overflow marker.

### Task 2: Render and rank call relations

**Files:**
- Modify: `src/analysis/xml-formatter.ts`

1. Add the callee cap option and default.
2. Rank callers deterministically by production status, confidence, and stable source location.
3. Rank and render direct callees with resolution metadata and overflow accounting.

### Task 3: Expose the formatter limit through `context`

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/commands/context.ts`

1. Add `--max-callees` to the context command.
2. Forward it only to XML formatting.

### Task 4: Verify

**Files:**
- Test: `tests/analysis/xml-formatter.test.ts`
- Test: `tests/commands/context.test.ts`

1. Run the focused formatter and context suites.
2. Run `bun run check` before claiming completion.

No commit is created: the user requested review of all changes first.
