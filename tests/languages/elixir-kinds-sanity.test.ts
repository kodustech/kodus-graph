// tests/languages/elixir-kinds-sanity.test.ts
//
// Grammar-drift guard for the Elixir extractor.
//
// The Elixir extractor matches tree-sitter node kinds + field names via the
// centralized `ELIXIR_KINDS` / `ELIXIR_FIELDS` maps (src/languages/elixir/
// kinds.ts). A `@ast-grep/lang-elixir` bump that renames/removes a node kind
// or field would silently break extraction with no error. This test parses a
// fixture exercising every kind/field and asserts each still appears in a real
// parse tree — turning that drift into a hard failure.
//
// NOTE: Elixir keywords (defmodule/def/defp/use/alias/import/test/if/case/...)
// are NOT node kinds; they are the TEXT of `identifier` `target` fields on
// generic `call` nodes. They are intentionally absent from ELIXIR_KINDS and so
// are not asserted here as kinds — only the structural kinds they produce are.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { ELIXIR_FIELDS, ELIXIR_KINDS } from '../../src/languages/elixir/kinds';
import '../../src/parser/languages';

// A single Elixir source that triggers every node kind referenced by the
// extractor: defmodule, @behaviour/@callback/@impl module attributes
// (unary_operator + binary_operator callback spec), use/alias/import (with
// `only:` keyword-list → keywords/pair/keyword/list), def/defp functions,
// dotted module calls (dot/alias), if/case control flow (stab_clause), a
// pipe binary_operator, and a `test "..."` ExUnit macro (string).
const FIXTURE = `
defmodule MyApp.Worker do
  @behaviour GenServer
  @callback handle(arg :: term) :: :ok
  @impl true
  use GenServer
  alias MyApp.Repo
  import Ecto.Query, only: [from: 2, where: 3]

  def run(x) do
    if x > 0 do
      Repo.get(x)
    else
      :error
    end

    case x do
      1 -> :one
      _ -> :other
    end

    x |> to_string()
  end

  defp helper, do: :ok

  test "it works" do
    assert true
  end
end
`;

/** Depth-first walk collecting every node kind present in the tree. */
function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

/** Depth-first walk collecting every field name resolvable on any node. */
function collectFields(node: SgNode, fields: readonly string[], into: Set<string>): void {
    for (const field of fields) {
        if (node.field(field)) {
            into.add(field);
        }
    }
    for (const child of node.children()) {
        collectFields(child, fields, into);
    }
}

describe('Elixir ELIXIR_KINDS grammar-drift guard', () => {
    it('every ELIXIR_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('elixir' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(ELIXIR_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-elixir grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update ELIXIR_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every ELIXIR_FIELDS value is resolvable in a real parse tree', async () => {
        const root = await parseAsync('elixir' as never, FIXTURE);
        const fieldValues = Object.values(ELIXIR_FIELDS);
        const present = new Set<string>();
        collectFields(root.root(), fieldValues, present);

        const missing = Object.entries(ELIXIR_FIELDS)
            .filter(([, field]) => !present.has(field))
            .map(([name, field]) => `${name} ('${field}')`);

        expect(missing).toEqual([]);
    });
});
