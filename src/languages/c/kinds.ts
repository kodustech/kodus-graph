/**
 * C / C++ tree-sitter AST node kinds and field names used by the shared
 * extractor (registered for both `c` and `cpp`).
 *
 * Every value is a real node kind verified against `@ast-grep/lang-c` and/or
 * `@ast-grep/lang-cpp` node-types.json. Kinds marked `(C++)` exist only in the
 * C++ grammar and are reached when parsing `.cpp`/`.hpp`/`.cc` files; they are
 * NOT dead code.
 *
 * NOT included (stay as literals at use sites): storage-class text matched via
 * `.text()` (`'static'`/`'extern'`), access-specifier text (`'public'`/
 * `'private'`), output/modifier strings (`'typedef'`/`'template'`), the lang
 * keys (`'c'`/`'cpp'`), and the `'class'|'interface'|'enum'`-style DTO
 * discriminators. `thisExpression` IS a C++ node kind (the `this` keyword) and
 * lives here; the parallel `.text() === 'this'` check stays a literal.
 */
export const C_KINDS = {
    // Declarations / containers
    typeDefinition: 'type_definition',
    structSpecifier: 'struct_specifier',
    classSpecifier: 'class_specifier', // C++
    enumSpecifier: 'enum_specifier',
    functionDefinition: 'function_definition',
    templateDeclaration: 'template_declaration', // C++
    declaration: 'declaration',
    preprocInclude: 'preproc_include',
    compoundStatement: 'compound_statement',

    // Declarators
    functionDeclarator: 'function_declarator',
    pointerDeclarator: 'pointer_declarator',
    referenceDeclarator: 'reference_declarator', // C++
    arrayDeclarator: 'array_declarator',
    initDeclarator: 'init_declarator',
    parameterList: 'parameter_list',

    // Identifiers / types
    identifier: 'identifier',
    fieldIdentifier: 'field_identifier',
    typeIdentifier: 'type_identifier',
    qualifiedIdentifier: 'qualified_identifier', // C++
    namespaceIdentifier: 'namespace_identifier', // C++
    primitiveType: 'primitive_type',
    typeQualifier: 'type_qualifier',
    sizedTypeSpecifier: 'sized_type_specifier',
    storageClassSpecifier: 'storage_class_specifier',

    // Heritage / access (C++)
    baseClassClause: 'base_class_clause', // C++
    accessSpecifier: 'access_specifier', // C++

    // Expressions
    callExpression: 'call_expression',
    fieldExpression: 'field_expression',
    thisExpression: 'this', // C++ — the `this` keyword node

    // Includes / strings
    systemLibString: 'system_lib_string',
    stringLiteral: 'string_literal',
    stringContent: 'string_content',

    // Branch kinds — drive cyclomatic complexity (see C_BRANCH_KINDS).
    // `catch_clause` is C++-only; harmless in C (never matches).
    ifStatement: 'if_statement',
    forStatement: 'for_statement',
    whileStatement: 'while_statement',
    doStatement: 'do_statement',
    caseStatement: 'case_statement',
    conditionalExpression: 'conditional_expression',
    catchClause: 'catch_clause', // C++
} as const;

/**
 * Tree-sitter field names accessed via `node.field(...)` on C / C++ nodes.
 */
export const C_FIELDS = {
    function: 'function',
    argument: 'argument',
    type: 'type',
} as const;
