/**
 * Elixir tree-sitter AST node kinds + field names used by the Elixir extractor.
 *
 * Every value is a real `@ast-grep/lang-elixir` node kind / field (verified
 * against the grammar's node-types.json and a live parse). Centralizing them
 * turns a grammar bump that renames/removes a kind into a single edit site plus
 * a failing kinds-sanity test, instead of a silent extraction regression.
 *
 * IMPORTANT — Elixir's grammar is unusual. Nearly every construct is a generic
 * `call` node; the language keywords are NOT distinct node kinds. `defmodule`,
 * `def`, `defp`, `use`, `alias`, `import`, `test`, `if`/`unless`/`for`,
 * `case`/`cond`/`with`/`try`, and module attributes like `@behaviour`,
 * `@callback`, `@impl` are distinguished by the TEXT of an `identifier`
 * (`call.field('target')?.text()`), not by their `.kind()`. Those text tokens
 * are therefore NOT kinds and intentionally STAY as string literals at their
 * use sites (see ELIXIR_SCALAR_BRANCH_CALLS, ELIXIR_MULTI_ARM_BRANCH_CALLS, the
 * `macroKeywords` set, and the various `target?.text() === 'def'` checks in the
 * extractor).
 *
 * Also NOT included here (they stay as literals): the `'Method'|'Function'`
 * kind discriminator and `'def'|'defp'` modifier strings on the function DTO,
 * the `ast_kind: 'call'` output value, and the `'elixir'` lang id.
 */
export const ELIXIR_KINDS = {
    // Universal container — defmodule/def/defp/use/alias/import/control-flow
    // macros are all `call` nodes, disambiguated by `field('target').text()`.
    call: 'call',

    // Call structure
    arguments: 'arguments',
    doBlock: 'do_block',

    // Targets / receivers
    identifier: 'identifier',
    dot: 'dot',
    alias: 'alias',

    // Operators — `unary_operator` carries `@attr` module attributes (operand
    // is the attribute `call`); `binary_operator` carries `name(args) :: type`
    // callback specs.
    unaryOperator: 'unary_operator',
    binaryOperator: 'binary_operator',

    // Literals
    string: 'string',

    // Keyword-list parsing (e.g. `import Mod, only: [foo: 2]`)
    keywords: 'keywords',
    pair: 'pair',
    keyword: 'keyword',
    list: 'list',

    // Multi-arm branch arm — drives cyclomatic complexity (one `stab_clause`
    // per case/cond/with/try arm).
    stabClause: 'stab_clause',
} as const;

/**
 * Tree-sitter field names read via `node.field(...)` in the Elixir extractor.
 *
 * `target` is the macro/function identifier of a `call` node; `operand` is the
 * inner node of a `unary_operator` (the `@attr` body).
 */
export const ELIXIR_FIELDS = {
    target: 'target',
    operand: 'operand',
} as const;
