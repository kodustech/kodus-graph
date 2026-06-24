/**
 * TypeScript / TSX / JavaScript tree-sitter AST node kinds and field names used
 * by the shared extractor (registered for `TypeScript`, `Tsx`, `JavaScript`).
 *
 * These grammars are built into `@ast-grep/napi` (no `@ast-grep/lang-*`
 * package), so there is no node-types.json to diff against — the
 * kinds-sanity test parses TS + TSX fixtures and asserts every kind appears.
 *
 * `TS_KINDS` values are tree-sitter node kinds; some exist only in the TS
 * grammar (interfaces/enums/type annotations) or only in TSX/JSX
 * (`jsx_*`). They are reached when parsing the corresponding file types and
 * are NOT dead.
 *
 * NOT included (stay literals at use sites): DTO discriminators
 * ('Function'/'Method'/'Constructor'), the method-name text check
 * `name === 'constructor'`, the `'ts'` import lang tag, the `'structural'`
 * capability value, and ast-grep pattern strings (`describe("$NAME", …)`).
 *
 * `TS_FIELDS` values are tree-sitter field names accessed via `node.field(...)`.
 */
export const TS_KINDS = {
    // Declarations / containers
    classDeclaration: 'class_declaration',
    abstractClassDeclaration: 'abstract_class_declaration', // TS
    interfaceDeclaration: 'interface_declaration', // TS
    enumDeclaration: 'enum_declaration', // TS
    functionDeclaration: 'function_declaration',
    functionExpression: 'function_expression',
    methodDefinition: 'method_definition',
    methodSignature: 'method_signature', // TS
    arrowFunction: 'arrow_function',
    variableDeclarator: 'variable_declarator',
    importStatement: 'import_statement',
    exportStatement: 'export_statement',
    exportKeyword: 'export',

    // Heritage
    classHeritage: 'class_heritage',
    extendsClause: 'extends_clause',
    implementsClause: 'implements_clause', // TS

    // Identifiers / types
    identifier: 'identifier',
    typeIdentifier: 'type_identifier', // TS
    memberExpression: 'member_expression',
    typeAnnotation: 'type_annotation', // TS
    genericType: 'generic_type', // TS
    accessibilityModifier: 'accessibility_modifier', // TS

    // Parameters
    formalParameters: 'formal_parameters',
    requiredParameter: 'required_parameter', // TS
    optionalParameter: 'optional_parameter', // TS

    // Expressions
    callExpression: 'call_expression',
    newExpression: 'new_expression',
    asExpression: 'as_expression', // TS

    // Imports / strings
    string: 'string',
    stringFragment: 'string_fragment',
    importClause: 'import_clause',
    namedImports: 'named_imports',
    importSpecifier: 'import_specifier',
    namespaceImport: 'namespace_import',

    // JSX (Tsx / Jsx only)
    jsxSelfClosingElement: 'jsx_self_closing_element',
    jsxOpeningElement: 'jsx_opening_element',
    jsxNamespaceName: 'jsx_namespace_name',

    // Branch kinds — drive cyclomatic complexity (see TS_BRANCH_KINDS).
    // `switch_case` (not `switch_statement`) is the case-level kind.
    ifStatement: 'if_statement',
    forStatement: 'for_statement',
    forInStatement: 'for_in_statement',
    whileStatement: 'while_statement',
    doStatement: 'do_statement',
    switchCase: 'switch_case',
    catchClause: 'catch_clause',
    ternaryExpression: 'ternary_expression',
} as const;

/**
 * Tree-sitter field names accessed via `node.field(...)` on TS / TSX / JS nodes.
 */
export const TS_FIELDS = {
    name: 'name',
    body: 'body',
    parameters: 'parameters',
    returnType: 'return_type',
    constructor: 'constructor',
    object: 'object',
    property: 'property',
    pattern: 'pattern',
    function: 'function',
} as const;
