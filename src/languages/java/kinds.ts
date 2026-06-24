// ---------------------------------------------------------------------------
// Java tree-sitter node KINDS and FIELD names.
//
// Single source of truth for every tree-sitter node-type literal and field
// name consumed by the Java extractor. Each KIND below is verified to exist
// in `@ast-grep/lang-java/src/node-types.json` (the published grammar). A
// grammar-drift sanity test (`tests/languages/java-kinds-sanity.test.ts`)
// parses a fixture exercising every kind and asserts none have disappeared.
//
// NOTE: NON-KIND string literals deliberately stay inline in the extractor:
// the lang id `'java'`, capability `'nominal'`, output node-kind discriminators
// (`'Function'`/`'Method'`/`'Constructor'`), DI annotation/stereotype names,
// test-annotation names, the `'public'` modifier keyword, the `'var'` text
// comparison, and the `'@CALLEE:'` deferred-resolution marker are all values,
// not tree-sitter node kinds, and must not be centralized here.
// ---------------------------------------------------------------------------

export const JAVA_KINDS = {
    // ── Declarations ────────────────────────────────────────────────────
    classDeclaration: 'class_declaration',
    recordDeclaration: 'record_declaration',
    interfaceDeclaration: 'interface_declaration',
    enumDeclaration: 'enum_declaration',
    methodDeclaration: 'method_declaration',
    constructorDeclaration: 'constructor_declaration',
    fieldDeclaration: 'field_declaration',
    localVariableDeclaration: 'local_variable_declaration',
    importDeclaration: 'import_declaration',
    variableDeclarator: 'variable_declarator',
    formalParameter: 'formal_parameter',

    // ── Modifiers / annotations ─────────────────────────────────────────
    modifiers: 'modifiers',
    markerAnnotation: 'marker_annotation',
    annotation: 'annotation',

    // ── Heritage ────────────────────────────────────────────────────────
    superclass: 'superclass',
    superInterfaces: 'super_interfaces',
    typeList: 'type_list',
    throws: 'throws',

    // ── Types / identifiers ─────────────────────────────────────────────
    identifier: 'identifier',
    typeIdentifier: 'type_identifier',
    scopedIdentifier: 'scoped_identifier',
    scopedTypeIdentifier: 'scoped_type_identifier',
    genericType: 'generic_type',

    // ── Expressions ─────────────────────────────────────────────────────
    methodInvocation: 'method_invocation',
    objectCreationExpression: 'object_creation_expression',
    fieldAccess: 'field_access',
    this: 'this',
    super: 'super',

    // ── Branch kinds (cyclomatic complexity) ────────────────────────────
    // `else if` is a nested `if_statement` in the alternative — `if_statement`
    // alone suffices. `switch_label` is the case-level kind (skip the outer
    // `switch_expression` / `switch_block`). Java has both classic
    // `for_statement` and `enhanced_for_statement` (for-each) — both decisions.
    ifStatement: 'if_statement',
    forStatement: 'for_statement',
    enhancedForStatement: 'enhanced_for_statement',
    whileStatement: 'while_statement',
    doStatement: 'do_statement',
    switchLabel: 'switch_label',
    catchClause: 'catch_clause',
    ternaryExpression: 'ternary_expression',
} as const;

export const JAVA_FIELDS = {
    name: 'name',
    type: 'type',
    body: 'body',
    parameters: 'parameters',
    value: 'value',
    object: 'object',
    field: 'field',
} as const;

export type JavaKind = (typeof JAVA_KINDS)[keyof typeof JAVA_KINDS];
export type JavaField = (typeof JAVA_FIELDS)[keyof typeof JAVA_FIELDS];
