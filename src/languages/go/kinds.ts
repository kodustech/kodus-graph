/**
 * Centralized tree-sitter node-KIND and FIELD-name string literals for the Go
 * extractor (grammar: `@ast-grep/lang-go`, parseAsync lang key `'go'`).
 *
 * Every value here is verified to exist in
 * `node_modules/@ast-grep/lang-go/src/node-types.json`. The
 * `tests/languages/go-kinds-sanity.test.ts` grammar-drift guard parses a Go
 * fixture and asserts each KIND below actually appears in the produced tree, so
 * a grammar bump that renames/removes a node fails loudly instead of silently
 * skipping a branch.
 *
 * Only AST node kinds and field names live here. Non-kind literals — output
 * discriminators (`'Method'`, `'struct'`), the lang id (`'go'`), capability
 * values (`'structural'`), and `.text()`/`.includes()` substring comparisons —
 * intentionally stay inline in the extractor.
 */

export const GO_KINDS = {
    // ── Type declarations (struct / interface) ──────────────────────────
    typeDeclaration: 'type_declaration',
    typeSpec: 'type_spec',
    structType: 'struct_type',
    interfaceType: 'interface_type',
    fieldDeclarationList: 'field_declaration_list',
    fieldDeclaration: 'field_declaration',
    typeIdentifier: 'type_identifier',

    // ── Functions / methods ─────────────────────────────────────────────
    functionDeclaration: 'function_declaration',
    methodDeclaration: 'method_declaration',
    parameterDeclaration: 'parameter_declaration',
    pointerType: 'pointer_type',
    qualifiedType: 'qualified_type',

    // ── Imports ─────────────────────────────────────────────────────────
    importDeclaration: 'import_declaration',
    interpretedStringLiteral: 'interpreted_string_literal',
    identifier: 'identifier',

    // ── Receiver-type inference (var / short-var / composites / calls) ───
    varSpec: 'var_spec',
    shortVarDeclaration: 'short_var_declaration',
    expressionList: 'expression_list',
    shortVarAssign: ':=',
    compositeLiteral: 'composite_literal',
    unaryExpression: 'unary_expression',
    callExpression: 'call_expression',
    selectorExpression: 'selector_expression',

    // ── Branch kinds for cyclomatic complexity ──────────────────────────
    // Case-level kinds only; outer switch/select statements are intentionally
    // excluded to avoid double-counting. See GO_BRANCH_KINDS in extractor.ts.
    ifStatement: 'if_statement',
    forStatement: 'for_statement',
    expressionCase: 'expression_case',
    typeCase: 'type_case',
    communicationCase: 'communication_case',
} as const;

/** Field names accessed via `node.field('...')` in the Go extractor. */
export const GO_FIELDS = {
    name: 'name',
    type: 'type',
    receiver: 'receiver',
    parameters: 'parameters',
    result: 'result',
    function: 'function',
    operand: 'operand',
} as const;
