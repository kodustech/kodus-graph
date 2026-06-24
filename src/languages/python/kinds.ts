/**
 * Python tree-sitter AST node kinds and field names used by the Python
 * extractor.
 *
 * Centralizing the grammar surface turns a `@ast-grep/lang-python` bump that
 * renames/removes a node kind or field into a single edit site plus a failing
 * kinds-sanity test, instead of a silent extraction regression scattered
 * across the extractor.
 *
 * `PYTHON_KINDS` values are tree-sitter node `kind()`s. They are NOT internal
 * DTO discriminators (`'Function'`/`'Method'`/`'Constructor'`), text
 * comparisons (`'self'`, the `async` keyword), or dunder method names
 * (`'__init__'`). Those stay as literals at their use sites.
 *
 * `PYTHON_FIELDS` values are tree-sitter field names consumed via
 * `node.field(...)`.
 */
export const PYTHON_KINDS = {
    // Definitions / containers
    classDefinition: 'class_definition',
    functionDefinition: 'function_definition',
    lambda: 'lambda',
    expressionStatement: 'expression_statement',

    // Imports
    importFromStatement: 'import_from_statement',
    importStatement: 'import_statement',
    dottedName: 'dotted_name',
    relativeImport: 'relative_import',

    // Identifiers / types
    identifier: 'identifier',
    type: 'type',
    genericType: 'generic_type',
    typeParameter: 'type_parameter',
    typedParameter: 'typed_parameter',
    typedDefaultParameter: 'typed_default_parameter',

    // Calls / assignments
    call: 'call',
    attribute: 'attribute',
    assignment: 'assignment',
    argumentList: 'argument_list',

    // Decorators / throws
    decorator: 'decorator',
    raiseStatement: 'raise_statement',

    // Branch kinds — drive cyclomatic complexity (see PY_BRANCH_KINDS).
    // Python emits `elif_clause` as a named child of the outer `if_statement`,
    // so both are needed to count elif branches.
    ifStatement: 'if_statement',
    elifClause: 'elif_clause',
    forStatement: 'for_statement',
    whileStatement: 'while_statement',
    exceptClause: 'except_clause',
    conditionalExpression: 'conditional_expression',
    caseClause: 'case_clause',
} as const;

/**
 * Tree-sitter field names accessed via `node.field(...)` on Python nodes.
 */
export const PYTHON_FIELDS = {
    name: 'name',
    body: 'body',
    parameters: 'parameters',
    superclasses: 'superclasses',
    returnType: 'return_type',
} as const;
