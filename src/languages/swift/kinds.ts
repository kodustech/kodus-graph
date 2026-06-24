/**
 * Swift tree-sitter AST node kinds used by the Swift extractor.
 *
 * Every value is a real `@ast-grep/lang-swift` node kind verified against the
 * grammar's node-types.json. Centralizing them turns a grammar bump that
 * renames/removes a kind into a single edit site plus a failing kinds-sanity
 * test, instead of a silent extraction regression.
 *
 * NOT included (stay literals at use sites): the `'class'|'struct'|'enum'`
 * discriminator returned by `swiftClassKind`, the `'init'` output name, the
 * `['throws']` output marker, modifier text matched on `extractModifiers()`
 * output (`'public'`/`'open'`), and the lang id. The keyword tokens
 * `enumKeyword`/`structKeyword`/`throwsKeyword` ARE node kinds (anonymous
 * tokens) and live here; their text/discriminator/output twins stay literals.
 */
export const SWIFT_KINDS = {
    // Declarations / containers
    classDeclaration: 'class_declaration',
    protocolDeclaration: 'protocol_declaration',
    functionDeclaration: 'function_declaration',
    initDeclaration: 'init_declaration',
    deinitDeclaration: 'deinit_declaration',
    importDeclaration: 'import_declaration',
    propertyDeclaration: 'property_declaration',
    protocolBody: 'protocol_body',
    protocolFunctionDeclaration: 'protocol_function_declaration',

    // Keyword tokens (distinguish class_declaration variants / throwing funcs)
    enumKeyword: 'enum',
    structKeyword: 'struct',
    throwsKeyword: 'throws',

    // Heritage
    inheritanceSpecifier: 'inheritance_specifier',

    // Identifiers / types
    identifier: 'identifier',
    simpleIdentifier: 'simple_identifier',
    typeIdentifier: 'type_identifier',
    userType: 'user_type',
    optionalType: 'optional_type',
    tupleType: 'tuple_type',
    arrayType: 'array_type',
    dictionaryType: 'dictionary_type',
    typeAnnotation: 'type_annotation',

    // Parameters / patterns / modifiers
    parameter: 'parameter',
    pattern: 'pattern',
    modifiers: 'modifiers',
    attribute: 'attribute',
    arrow: '->',

    // Calls
    callExpression: 'call_expression',
    navigationExpression: 'navigation_expression',

    // Branch kinds — drive cyclomatic complexity (see SWIFT_BRANCH_KINDS).
    // `switch_entry` is the case-arm kind; `catch_block` (not `catch_clause`).
    ifStatement: 'if_statement',
    guardStatement: 'guard_statement',
    forStatement: 'for_statement',
    whileStatement: 'while_statement',
    repeatWhileStatement: 'repeat_while_statement',
    switchEntry: 'switch_entry',
    catchBlock: 'catch_block',
    ternaryExpression: 'ternary_expression',
} as const;
