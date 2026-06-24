/**
 * Rust tree-sitter AST node kinds and field names used by the Rust extractor.
 *
 * Every value in `RUST_KINDS` is a real `@ast-grep/lang-rust` node kind and
 * every value in `RUST_FIELDS` is a real field name (both verified against the
 * grammar's node-types.json). Centralizing them turns a grammar bump that
 * renames/removes a kind into a single edit site plus a failing kinds-sanity
 * test, instead of a silent extraction regression.
 *
 * Several polyglot fallback kinds that the shared import-helper shape once
 * carried — `string`, `interpreted_string_literal`, `string_fragment`,
 * `qualified_name`, `name`, `namespace_name`, `use_tree` — do NOT exist in the
 * Rust grammar (0 occurrences in node-types.json) and could never be produced
 * by a Rust parse, so their branches were removed as provably dead. The real
 * Rust string kinds are `string_literal` / `raw_string_literal` with a
 * `string_content` child.
 *
 * NOT included: the lang id `'rust'`, the test-attribute name `'test'`, the
 * `self.` call prefix, the `'Function' | 'Method' | 'Constructor'` DTO
 * discriminator, the `'nominal'` interface-kind capability value, and the
 * default output strings (`'()'`, `''`) — those are not node kinds and stay as
 * literals at their use sites.
 */
export const RUST_KINDS = {
    // Declarations / containers
    structItem: 'struct_item',
    traitItem: 'trait_item',
    enumItem: 'enum_item',
    functionItem: 'function_item',
    implItem: 'impl_item',
    useDeclaration: 'use_declaration',
    letDeclaration: 'let_declaration',

    // Attributes (Rust `#[...]` modeled as decorators) / modifiers
    attributeItem: 'attribute_item',
    visibilityModifier: 'visibility_modifier',

    // Import-path identifiers (children of `use_declaration`)
    scopedIdentifier: 'scoped_identifier',
    scopedTypeIdentifier: 'scoped_type_identifier',
    identifier: 'identifier',
    typeIdentifier: 'type_identifier',

    // Parameters / types (receiver-type inference)
    parameter: 'parameter',
    referenceType: 'reference_type',
    genericType: 'generic_type',

    // Calls / expressions
    callExpression: 'call_expression',
    fieldExpression: 'field_expression',

    // Branch kinds — drive cyclomatic complexity (see RUST_BRANCH_KINDS).
    // `match_arm` is the case-arm kind; `if_expression` covers both `else if`
    // and `if let`. `while let` is still a `while_expression`.
    ifExpression: 'if_expression',
    matchArm: 'match_arm',
    forExpression: 'for_expression',
    whileExpression: 'while_expression',
    loopExpression: 'loop_expression',
} as const;

/**
 * Rust tree-sitter field names referenced via `node.field('...')`.
 * All verified present in the grammar's node-types.json.
 */
export const RUST_FIELDS = {
    name: 'name',
    type: 'type',
    trait: 'trait',
    parameters: 'parameters',
    returnType: 'return_type',
    function: 'function',
    value: 'value',
    pattern: 'pattern',
} as const;
