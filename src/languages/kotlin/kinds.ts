/**
 * Kotlin tree-sitter AST node kinds used by the Kotlin extractor.
 *
 * Every value is a real `@ast-grep/lang-kotlin` node kind (verified against
 * the grammar's node-types.json). Centralizing them turns a grammar bump that
 * renames/removes a kind into a single edit site plus a failing kinds-sanity
 * test, instead of a silent extraction regression.
 *
 * NOT included: modifier text matched against `extractModifiers()` output
 * (`'private'`, `'suspend'`, …), DI annotation names (`'Inject'`, `'Service'`),
 * the `'class'|'interface'|'enum'` DTO discriminator returned by
 * `kotlinClassKind`, and the lang id — those stay as literals at their use
 * sites. The keyword tokens `interfaceKeyword`/`enumKeyword` ARE node kinds
 * (anonymous tokens distinguishing `class_declaration` variants) and so live
 * here.
 */
export const KOTLIN_KINDS = {
    // Declarations / containers
    classDeclaration: 'class_declaration',
    objectDeclaration: 'object_declaration',
    functionDeclaration: 'function_declaration',
    propertyDeclaration: 'property_declaration',
    primaryConstructor: 'primary_constructor',
    importHeader: 'import_header',
    functionBody: 'function_body',

    // Keyword tokens distinguishing class_declaration variants
    interfaceKeyword: 'interface',
    enumKeyword: 'enum',

    // Heritage
    delegationSpecifier: 'delegation_specifier',
    constructorInvocation: 'constructor_invocation',

    // Identifiers / types
    simpleIdentifier: 'simple_identifier',
    identifier: 'identifier',
    typeIdentifier: 'type_identifier',
    userType: 'user_type',
    nullableType: 'nullable_type',
    functionType: 'function_type',

    // Parameters
    functionValueParameters: 'function_value_parameters',
    parameter: 'parameter',
    classParameter: 'class_parameter',
    bindingPatternKind: 'binding_pattern_kind',

    // Modifiers / annotations / bindings
    modifiers: 'modifiers',
    annotation: 'annotation',
    variableDeclaration: 'variable_declaration',

    // Calls / expressions
    callExpression: 'call_expression',
    navigationExpression: 'navigation_expression',
    asExpression: 'as_expression',
    infixExpression: 'infix_expression',

    // Punctuation tokens
    colon: ':',
    eq: '=',

    // Branch kinds — drive cyclomatic complexity (see KOTLIN_BRANCH_KINDS).
    // `when_entry` is the case-arm kind; `if_expression` covers `else if`.
    // Kotlin uses `catch_block` (not `catch_clause`).
    ifExpression: 'if_expression',
    forStatement: 'for_statement',
    whileStatement: 'while_statement',
    doWhileStatement: 'do_while_statement',
    whenEntry: 'when_entry',
    catchBlock: 'catch_block',
} as const;
