// ---------------------------------------------------------------------------
// RUBY_KINDS / RUBY_FIELDS — tree-sitter (@ast-grep/lang-ruby) node-KIND and
// FIELD-name literals used by the Ruby extractor.
//
// Centralized here so a grammar drift (a renamed/removed node type) surfaces in
// one place and is covered by tests/languages/ruby-kinds-sanity.test.ts. Every
// value below is a real grammar node type verified against
// node_modules/@ast-grep/lang-ruby/src/node-types.json.
//
// NOTE: method-name TEXT checks ('initialize', 'require', 'attr_accessor',
// 'self', …) and ast-grep PATTERN strings are NOT kinds and intentionally stay
// as inline literals in the extractor.
// ---------------------------------------------------------------------------

export const RUBY_KINDS = {
    // Declarations (migrated from the former LANG_KINDS.ruby map).
    classDeclaration: 'class',
    method: 'method',
    module: 'module',
    singletonMethod: 'singleton_method',
    call: 'call',

    // Call/identifier extraction.
    identifier: 'identifier',
    bodyStatement: 'body_statement',

    // Branch kinds for cyclomatic complexity. Ruby's grammar reuses bare
    // keywords (`if`, `when`, …) as BOTH named container-node kinds AND
    // anonymous keyword leaves; the helper filters to named nodes to avoid
    // double-counting. `when` (case-arm) is used; outer `case` is excluded.
    // `elsif` is a named sibling inside `if`, so both are listed. Modifiers
    // (`x if cond`) have their own kind (`if_modifier`).
    if: 'if',
    elsif: 'elsif',
    unless: 'unless',
    ifModifier: 'if_modifier',
    unlessModifier: 'unless_modifier',
    while: 'while',
    until: 'until',
    whileModifier: 'while_modifier',
    untilModifier: 'until_modifier',
    for: 'for',
    when: 'when',
    rescue: 'rescue',
    conditional: 'conditional',
} as const;

export const RUBY_FIELDS = {
    name: 'name',
    superclass: 'superclass',
    parameters: 'parameters',
    method: 'method',
    receiver: 'receiver',
} as const;
