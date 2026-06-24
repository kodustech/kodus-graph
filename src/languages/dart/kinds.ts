/**
 * Dart tree-sitter AST node kinds used by the Dart extractor.
 *
 * Every value here is a tree-sitter node `kind()` produced by
 * `@ast-grep/lang-dart` — NOT an internal DTO discriminator
 * (`'Function'`/`'Method'`/`'Constructor'`), a modifier output string, or a
 * type name (`'Future'`). Centralizing the grammar kinds turns a grammar
 * update (a renamed/removed node kind on a lang-dart bump) into a single edit
 * site plus a failing kinds-sanity test, instead of a silent extraction
 * regression scattered across the extractor.
 *
 * Keys are camelCase; values are the literal grammar kinds.
 */
export const DART_KINDS = {
    // Declarations / containers
    classDefinition: 'class_definition',
    mixinDeclaration: 'mixin_declaration',
    extensionDeclaration: 'extension_declaration',
    enumDeclaration: 'enum_declaration',
    classBody: 'class_body',
    declaration: 'declaration',

    // Signatures
    methodSignature: 'method_signature',
    functionSignature: 'function_signature',
    constructorSignature: 'constructor_signature',
    factoryConstructorSignature: 'factory_constructor_signature',
    getterSignature: 'getter_signature',
    setterSignature: 'setter_signature',
    functionBody: 'function_body',

    // Heritage
    superclass: 'superclass',
    interfaces: 'interfaces',
    mixins: 'mixins',
    on: 'on',

    // Identifiers / types
    identifier: 'identifier',
    typeIdentifier: 'type_identifier',
    voidType: 'void_type',

    // Parameters
    formalParameterList: 'formal_parameter_list',

    // Imports
    importOrExport: 'import_or_export',
    uri: 'uri',

    // Calls / selectors / bindings
    selector: 'selector',
    argumentPart: 'argument_part',
    unconditionalAssignableSelector: 'unconditional_assignable_selector',
    newExpression: 'new_expression',
    initializedVariableDefinition: 'initialized_variable_definition',

    // Annotations
    markerAnnotation: 'marker_annotation',
    annotation: 'annotation',

    // Modifiers / keywords (these surface as their own node kinds)
    abstract: 'abstract',
    static: 'static',
    async: 'async',
    this: 'this',
    super: 'super',
    eq: '=',

    // Branch kinds — drive cyclomatic complexity (see DART_BRANCH_KINDS)
    ifStatement: 'if_statement',
    forStatement: 'for_statement',
    whileStatement: 'while_statement',
    doStatement: 'do_statement',
    switchLabel: 'switch_label',
    catchClause: 'catch_clause',
    conditionalExpression: 'conditional_expression',
} as const;

/**
 * Node-kind suffix shared by Dart's parameter node variants
 * (`normal_formal_parameter`, `super_formal_parameter`, ...). Matched via
 * `.endsWith()` because the grammar exposes several formal-parameter kinds and
 * the extractor treats them uniformly.
 */
export const DART_FORMAL_PARAMETER_SUFFIX = 'formal_parameter';
