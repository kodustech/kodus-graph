/**
 * PHP tree-sitter AST node kinds (and field names) used by the PHP extractor.
 *
 * Every value is a real `@ast-grep/lang-php` node kind / field, verified
 * against the grammar's node-types.json. Centralizing them turns a grammar
 * bump that renames/removes a kind into a single edit site plus a failing
 * kinds-sanity test, instead of a silent extraction regression.
 *
 * NOT included (these stay as literals at their use sites):
 *   - text comparisons against `.text()`: `'$this'`, `'public'`, `'__construct'`,
 *     `'parent'`, `'self'`, `'static'`.
 *   - DTO discriminators / output strings: `'Function'|'Method'|'Constructor'`,
 *     the `lang: 'php'` import tag, and the `'php'` language id passed to
 *     register* helpers.
 *   - substring ancestor probes (`k.includes('class'|'struct'|'impl')`) — these
 *     are NOT exact-kind comparisons.
 *   - regex test-detection patterns (`/^test/`, `/Test\.php$/`).
 *
 * Cross-language cruft that was carried in the import helpers but is NOT a PHP
 * grammar kind has been removed from the extractor (see git history): the
 * string-literal import branch (`interpreted_string_literal`, `string_fragment`),
 * the `scoped_identifier`/`scoped_type_identifier` branch, `use_tree`, and the
 * `identifier`/`type_identifier` branch — none of these are emitted by the PHP
 * grammar, so those branches were provably dead.
 */
export const PHP_KINDS = {
    // Declarations / containers
    classDeclaration: 'class_declaration',
    interfaceDeclaration: 'interface_declaration',
    traitDeclaration: 'trait_declaration',
    functionDefinition: 'function_definition',
    methodDeclaration: 'method_declaration',
    propertyDeclaration: 'property_declaration',
    propertyElement: 'property_element',
    namespaceUseDeclaration: 'namespace_use_declaration',

    // Heritage
    baseClause: 'base_clause',
    classInterfaceClause: 'class_interface_clause',

    // Names / identifiers / types
    name: 'name',
    qualifiedName: 'qualified_name',
    namespaceName: 'namespace_name',
    namedType: 'named_type',
    variableName: 'variable_name',

    // Strings (import-module extraction)
    string: 'string',
    stringContent: 'string_content',

    // Parameters / modifiers
    simpleParameter: 'simple_parameter',
    propertyPromotionParameter: 'property_promotion_parameter',
    visibilityModifier: 'visibility_modifier',

    // Calls / expressions
    functionCallExpression: 'function_call_expression',
    memberCallExpression: 'member_call_expression',
    memberAccessExpression: 'member_access_expression',
    scopedCallExpression: 'scoped_call_expression',
    relativeScope: 'relative_scope',
    objectCreationExpression: 'object_creation_expression',
    assignmentExpression: 'assignment_expression',

    // Punctuation token
    doubleColon: '::',

    // Branch kinds — drive cyclomatic complexity (see PHP_BRANCH_KINDS).
    // PHP emits `else_if_clause` as a named child of `if_statement` (NOT a
    // nested if), and `case_statement` is the per-case kind. `throw_expression`
    // feeds `extractThrows`.
    ifStatement: 'if_statement',
    elseIfClause: 'else_if_clause',
    forStatement: 'for_statement',
    foreachStatement: 'foreach_statement',
    whileStatement: 'while_statement',
    doStatement: 'do_statement',
    caseStatement: 'case_statement',
    catchClause: 'catch_clause',
    conditionalExpression: 'conditional_expression',
    throwExpression: 'throw_expression',
} as const;

/**
 * PHP tree-sitter field names accessed via `node.field('X')`. All verified
 * against the grammar's node-types.json.
 */
export const PHP_FIELDS = {
    name: 'name',
    parameters: 'parameters',
    returnType: 'return_type',
    left: 'left',
    right: 'right',
} as const;
