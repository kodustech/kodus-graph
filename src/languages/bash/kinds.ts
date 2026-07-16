/**
 * Bash / Shell tree-sitter AST node kinds and field names used by the bash
 * extractor (grammar: `@ast-grep/lang-bash`, parseAsync lang key `'bash'`).
 *
 * Every value was verified empirically against the installed grammar by parsing
 * real shell (function definitions in both `f() {}` and `function f {}` form,
 * `source`/`.` sourcing, and every loop/branch construct). Centralizing the
 * grammar surface here means a grammar bump that renames a kind breaks the
 * sanity test, not the extractor silently.
 */
export const BASH_KINDS = {
    // Definitions / containers
    functionDefinition: 'function_definition',
    compoundStatement: 'compound_statement',
    program: 'program',

    // Calls
    command: 'command',
    commandName: 'command_name',
    word: 'word',

    // Branch kinds — drive cyclomatic complexity (see BASH_BRANCH_KINDS).
    ifStatement: 'if_statement',
    elifClause: 'elif_clause',
    whileStatement: 'while_statement',
    forStatement: 'for_statement',
    cStyleForStatement: 'c_style_for_statement',
    caseItem: 'case_item',
} as const;

/**
 * Tree-sitter field names accessed via `node.field(...)` on bash nodes.
 * `function_definition` and `command` both expose their identity via `name`.
 */
export const BASH_FIELDS = {
    name: 'name',
} as const;
