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
    CLASS_DECLARATION: 'class_declaration',
    RECORD_DECLARATION: 'record_declaration',
    INTERFACE_DECLARATION: 'interface_declaration',
    ENUM_DECLARATION: 'enum_declaration',
    METHOD_DECLARATION: 'method_declaration',
    CONSTRUCTOR_DECLARATION: 'constructor_declaration',
    FIELD_DECLARATION: 'field_declaration',
    LOCAL_VARIABLE_DECLARATION: 'local_variable_declaration',
    IMPORT_DECLARATION: 'import_declaration',
    VARIABLE_DECLARATOR: 'variable_declarator',
    FORMAL_PARAMETER: 'formal_parameter',

    // ── Modifiers / annotations ─────────────────────────────────────────
    MODIFIERS: 'modifiers',
    MARKER_ANNOTATION: 'marker_annotation',
    ANNOTATION: 'annotation',

    // ── Heritage ────────────────────────────────────────────────────────
    SUPERCLASS: 'superclass',
    SUPER_INTERFACES: 'super_interfaces',
    TYPE_LIST: 'type_list',
    THROWS: 'throws',

    // ── Types / identifiers ─────────────────────────────────────────────
    IDENTIFIER: 'identifier',
    TYPE_IDENTIFIER: 'type_identifier',
    SCOPED_IDENTIFIER: 'scoped_identifier',
    SCOPED_TYPE_IDENTIFIER: 'scoped_type_identifier',
    GENERIC_TYPE: 'generic_type',

    // ── Expressions ─────────────────────────────────────────────────────
    METHOD_INVOCATION: 'method_invocation',
    OBJECT_CREATION_EXPRESSION: 'object_creation_expression',
    FIELD_ACCESS: 'field_access',
    THIS: 'this',
    SUPER: 'super',

    // ── Branch kinds (cyclomatic complexity) ────────────────────────────
    // `else if` is a nested `if_statement` in the alternative — `if_statement`
    // alone suffices. `switch_label` is the case-level kind (skip the outer
    // `switch_expression` / `switch_block`). Java has both classic
    // `for_statement` and `enhanced_for_statement` (for-each) — both decisions.
    IF_STATEMENT: 'if_statement',
    FOR_STATEMENT: 'for_statement',
    ENHANCED_FOR_STATEMENT: 'enhanced_for_statement',
    WHILE_STATEMENT: 'while_statement',
    DO_STATEMENT: 'do_statement',
    SWITCH_LABEL: 'switch_label',
    CATCH_CLAUSE: 'catch_clause',
    TERNARY_EXPRESSION: 'ternary_expression',
} as const;

export const JAVA_FIELDS = {
    NAME: 'name',
    TYPE: 'type',
    BODY: 'body',
    PARAMETERS: 'parameters',
    VALUE: 'value',
    OBJECT: 'object',
    FIELD: 'field',
} as const;

export type JavaKind = (typeof JAVA_KINDS)[keyof typeof JAVA_KINDS];
export type JavaField = (typeof JAVA_FIELDS)[keyof typeof JAVA_FIELDS];
