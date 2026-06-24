// ---------------------------------------------------------------------------
// C# tree-sitter node KINDS and FIELD names
// ---------------------------------------------------------------------------
//
// Centralized catalog of every tree-sitter node-kind string and field name the
// C# extractor depends on. Importing these instead of inlining string literals
// gives us a single source of truth and a grammar-drift guard: the sanity test
// (tests/languages/csharp-kinds-sanity.test.ts) parses representative C# source
// and asserts every value below is actually emitted by the active grammar
// (@ast-grep/lang-csharp). If a grammar upgrade renames or drops a kind, that
// test fails loudly instead of the extractor silently producing empty results.
//
// Intentionally EXCLUDED (cross-language cruft the C# grammar never emits, so
// the corresponding branches were removed): type_identifier, parameter_modifier,
// string, interpreted_string_literal, string_fragment, string_content,
// scoped_identifier, scoped_type_identifier, namespace_name, use_tree, and the
// bare `name` kind. These were verified absent against node-types.json and by
// parsing real C# source.

export const CSHARP_KINDS = {
    // ── Type / member declarations ──────────────────────────────────────
    classDeclaration: 'class_declaration',
    recordDeclaration: 'record_declaration',
    structDeclaration: 'struct_declaration',
    interfaceDeclaration: 'interface_declaration',
    enumDeclaration: 'enum_declaration',
    constructorDeclaration: 'constructor_declaration',
    methodDeclaration: 'method_declaration',
    localFunctionStatement: 'local_function_statement',
    fieldDeclaration: 'field_declaration',
    propertyDeclaration: 'property_declaration',
    declarationList: 'declaration_list',

    // ── Parameters / variables ──────────────────────────────────────────
    parameter: 'parameter',
    parameterList: 'parameter_list',
    variableDeclaration: 'variable_declaration',
    variableDeclarator: 'variable_declarator',

    // ── Types / names ───────────────────────────────────────────────────
    identifier: 'identifier',
    qualifiedName: 'qualified_name',
    genericName: 'generic_name',
    predefinedType: 'predefined_type',
    nullableType: 'nullable_type',
    arrayType: 'array_type',
    baseList: 'base_list',

    // ── Modifiers / attributes ──────────────────────────────────────────
    modifier: 'modifier',
    attributeList: 'attribute_list',
    attribute: 'attribute',

    // ── Expressions ─────────────────────────────────────────────────────
    objectCreationExpression: 'object_creation_expression',
    invocationExpression: 'invocation_expression',
    memberAccessExpression: 'member_access_expression',

    // ── Imports ─────────────────────────────────────────────────────────
    usingDirective: 'using_directive',

    // ── Statements ──────────────────────────────────────────────────────
    throwStatement: 'throw_statement',

    // ── Branch kinds (cyclomatic complexity) ────────────────────────────
    // `switch_section` is the per-case kind (skip outer `switch_statement`).
    // `if_statement` alone covers `else if` (nested if in alternative).
    // `conditional_access_expression` is `?.` (short-circuiting) which adds a
    // branch.
    ifStatement: 'if_statement',
    forStatement: 'for_statement',
    foreachStatement: 'foreach_statement',
    whileStatement: 'while_statement',
    doStatement: 'do_statement',
    switchSection: 'switch_section',
    catchClause: 'catch_clause',
    conditionalExpression: 'conditional_expression',
    conditionalAccessExpression: 'conditional_access_expression',
} as const;

export const CSHARP_FIELDS = {
    function: 'function',
    name: 'name',
    parameters: 'parameters',
    returns: 'returns',
    type: 'type',
    expression: 'expression',
} as const;
