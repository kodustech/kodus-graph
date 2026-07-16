// tests/languages/bash-kinds-sanity.test.ts
//
// Grammar-drift guard for the Bash extractor.
//
// The Bash extractor matches tree-sitter node kinds and field names via the
// centralized `BASH_KINDS` / `BASH_FIELDS` maps (src/languages/bash/kinds.ts).
// A `@ast-grep/lang-bash` bump that renames/removes a node kind or field would
// silently break extraction with no error. This test parses a fixture
// exercising every kind and field and asserts they still resolve in a real
// parse tree — turning that drift into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { BASH_FIELDS, BASH_KINDS } from '../../src/languages/bash/kinds';
import '../../src/parser/languages';

// A single Bash source that triggers every node kind referenced by the
// extractor: both function-definition forms, sourcing, bare command calls, and
// every branch kind used for cyclomatic complexity (if/elif, while, for-in,
// c-style for, and case arms).
const FIXTURE = `#!/usr/bin/env bash
source ./lib.sh

greet() {
  echo "hi"
  log_info "greeted"
}

function run {
  local n=0
  if [ "$1" = a ]; then
    greet
  elif [ "$1" = b ]; then
    greet
  fi
  for x in 1 2 3; do
    echo "$x"
  done
  for ((i = 0; i < 3; i++)); do
    echo "$i"
  done
  while [ $n -lt 3 ]; do
    n=$((n + 1))
  done
  case "$1" in
    a) echo A ;;
    b) echo B ;;
  esac
}

run "$@"
`;

/** Depth-first walk collecting every node kind present in the tree. */
function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

/** Depth-first collect of all nodes of a given kind. */
function collectByKind(node: SgNode, kind: string, into: SgNode[]): void {
    if (String(node.kind()) === kind) {
        into.push(node);
    }
    for (const child of node.children()) {
        collectByKind(child, kind, into);
    }
}

describe('Bash BASH_KINDS / BASH_FIELDS grammar-drift guard', () => {
    it('every BASH_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('bash' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(BASH_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-bash grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update BASH_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('BASH_FIELDS.name resolves on both function_definition and command', async () => {
        const root = await parseAsync('bash' as never, FIXTURE);
        const rootNode = root.root();

        const functions: SgNode[] = [];
        collectByKind(rootNode, BASH_KINDS.functionDefinition, functions);
        const commands: SgNode[] = [];
        collectByKind(rootNode, BASH_KINDS.command, commands);

        const fieldResolves = (nodes: SgNode[], field: string) =>
            nodes.some((n) => n.field(field) !== null && n.field(field) !== undefined);

        // `greet() {}` and `function run {}` both expose their name via `name`.
        expect(fieldResolves(functions, BASH_FIELDS.name)).toBe(true);
        // `log_info "greeted"` exposes the command name via `name`.
        expect(fieldResolves(commands, BASH_FIELDS.name)).toBe(true);
    });
});
