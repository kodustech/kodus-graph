/**
 * Scala tree-sitter AST node kinds (and fields) used by the Scala extractor.
 *
 * Every value is a real `@ast-grep/lang-scala` node kind (verified against the
 * grammar's node-types.json). Centralizing them turns a grammar bump that
 * renames/removes a kind into a single edit site plus a failing kinds-sanity
 * test, instead of a silent extraction regression.
 *
 * NOT included (stay as literals at their use sites): the lang id `'scala'`,
 * the `@CALLEE:` receiver marker, the `@throws[...]` annotation regex, the
 * `'Function'|'Method'|'Constructor'` DTO discriminator, modifier text matched
 * against `extractModifiers()` output (`'private'`, `'protected'`), the
 * `'this.'`/`'super.'` self/super call prefixes, the DI heuristic strings, and
 * the capability values — none of those are node kinds.
 *
 * The keyword/punctuation tokens `case`, `with`, and `:` ARE node kinds in the
 * Scala grammar (anonymous tokens) and so live here.
 */
export const SCALA_KINDS = {
    // Declarations / containers
    classDefinition: 'class_definition',
    objectDefinition: 'object_definition',
    traitDefinition: 'trait_definition',
    functionDefinition: 'function_definition',
    functionDeclaration: 'function_declaration',
    valDefinition: 'val_definition',
    importDeclaration: 'import_declaration',
    templateBody: 'template_body',

    // Heritage
    extendsClause: 'extends_clause',

    // Identifiers / types
    identifier: 'identifier',
    typeIdentifier: 'type_identifier',
    genericType: 'generic_type',
    namespaceWildcard: 'namespace_wildcard',

    // Parameters
    parameters: 'parameters',
    parameter: 'parameter',

    // Modifiers / annotations
    annotation: 'annotation',

    // Calls / expressions
    callExpression: 'call_expression',
    fieldExpression: 'field_expression',
    instanceExpression: 'instance_expression',

    // Keyword / punctuation tokens (anonymous node kinds)
    case: 'case',
    with: 'with',
    colon: ':',

    // Branch kinds — drive cyclomatic complexity (see SCALA_BRANCH_KINDS).
    // `case_clause` is reused for BOTH match-arms AND catch-arms (Scala catch
    // syntax uses pattern matching); using it alone avoids double-counting.
    // `if_expression` alone covers `else if`.
    ifExpression: 'if_expression',
    forExpression: 'for_expression',
    whileExpression: 'while_expression',
    doWhileExpression: 'do_while_expression',
    caseClause: 'case_clause',
} as const;

/**
 * Scala tree-sitter named fields used by the extractor (`node.field('X')`).
 * Verified to exist in the grammar's node-types.json.
 */
export const SCALA_FIELDS = {
    function: 'function',
} as const;
