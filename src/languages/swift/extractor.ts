import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import {
    computeContentHash,
    emptyResult,
    extractModifiers,
    isAsync,
    isExported,
    isTestByNaming,
    nodeRange,
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for Swift cyclomatic complexity.
// Empirically verified against the Swift tree-sitter grammar:
// - `switch_entry` is the case-arm kind (NOT `case_statement`); skip outer `switch_statement`.
// - `catch_block` is the Swift kind (NOT `catch_clause`).
// - `else if` is a nested `if_statement` in the alternative; `if_statement` alone covers it.
// - `guard` is a decision (guarded fall-through vs. else branch).
const SWIFT_BRANCH_KINDS = [
    'if_statement',
    'guard_statement',
    'for_statement',
    'while_statement',
    'repeat_while_statement',
    'switch_entry',
    'catch_block',
    'ternary_expression',
] as const;

// ---------------------------------------------------------------------------
// Swift disambiguation helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a Swift `class_declaration` node is a class, struct, or enum.
 * In Swift's tree-sitter grammar, all three share the `class_declaration` kind
 * and are distinguished by the presence of `class`, `struct`, or `enum` child tokens.
 */
function swiftClassKind(node: SgNode): 'class' | 'struct' | 'enum' {
    const children = node.children();
    if (children.some((c) => c.kind() === 'enum')) {
        return 'enum';
    }
    if (children.some((c) => c.kind() === 'struct')) {
        return 'struct';
    }
    return 'class';
}

/**
 * Get the name for a Swift `class_declaration` or `protocol_declaration` node.
 * The name lives in a `type_identifier` child node.
 */
function swiftTypeName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'type_identifier')
        ?.text();
}

/**
 * Get the name for a Swift `function_declaration` or `init_declaration` node.
 * Function names are `simple_identifier` children.
 */
function swiftFuncName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'simple_identifier')
        ?.text();
}

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first inheritance specifier as the superclass.
 * In Swift, class X: Base, Protocol — the first is typically the superclass
 * (when the class inherits from another class), but Swift does not syntactically
 * distinguish base class from protocol conformance in the inheritance clause.
 *
 * Heuristic: We treat the first inheritance_specifier as extends if the
 * current node is a class (not struct/enum, since structs don't inherit).
 */
function swiftExtends(node: SgNode): string | undefined {
    const kind = swiftClassKind(node);
    // Only classes can have superclasses in Swift (structs and enums cannot inherit)
    if (kind !== 'class') {
        return undefined;
    }

    const specifiers = node.children().filter((c) => c.kind() === 'inheritance_specifier');
    if (specifiers.length === 0) {
        return undefined;
    }

    // The first specifier is typically the superclass (by Swift convention)
    const first = specifiers[0];
    const userType = first.children().find((c) => c.kind() === 'user_type');
    const typeId = userType?.children().find((c) => c.kind() === 'type_identifier');
    return typeId?.text();
}

/**
 * Extract implemented protocols from the inheritance clause.
 * For classes: all inheritance_specifiers after the first (which is extends).
 * For structs: all inheritance_specifiers are protocols.
 */
function swiftImplements(node: SgNode): string[] {
    const kind = swiftClassKind(node);
    const specifiers = node.children().filter((c) => c.kind() === 'inheritance_specifier');

    if (specifiers.length === 0) {
        return [];
    }

    // For structs and enums, all specifiers are protocols
    // For classes, skip the first (superclass)
    const startIdx = kind === 'class' && specifiers.length > 1 ? 1 : 0;
    // If class has only one specifier, we already treat it as extends, so no implements
    if (kind === 'class' && specifiers.length === 1) {
        return [];
    }

    const protocols: string[] = [];
    for (let i = startIdx; i < specifiers.length; i++) {
        const userType = specifiers[i].children().find((c) => c.kind() === 'user_type');
        const typeId = userType?.children().find((c) => c.kind() === 'type_identifier');
        if (typeId) {
            protocols.push(typeId.text());
        }
    }
    return protocols;
}

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    // Swift imports have an `identifier` child containing `simple_identifier`
    const identifier = node.children().find((c) => c.kind() === 'identifier');
    if (identifier) {
        return identifier.text();
    }

    // Fallback: strip the import keyword
    return node
        .text()
        .replace(/^\s*import\s+/i, '')
        .replace(/[;{}]/g, '')
        .trim();
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const FILE_PATTERNS = [/Tests?\.swift$/, /test/i];
const FUNC_PATTERNS = [/^test/i];

// ---------------------------------------------------------------------------
// Swift-specific helpers for new fields
// ---------------------------------------------------------------------------

/**
 * Swift is internal by default.
 * Exported means public or open modifier.
 */
const swiftExportRules = {
    customCheck: (_name: string, node: SgNode) => {
        const mods = extractModifiers(node);
        return mods.includes('public') || mods.includes('open');
    },
};

/** Extract throws from Swift function signature. */
function swiftThrows(node: SgNode): string[] {
    const hasThrows = node.children().some((c) => c.kind() === 'throws');
    return hasThrows ? ['throws'] : [];
}

/** Extract Swift attributes (@objc, @discardableResult, etc.) from a node. */
function swiftDecorators(node: SgNode): string[] {
    const decorators: string[] = [];

    // Check modifiers child for attribute nodes
    const mods = node.children().find((c) => c.kind() === 'modifiers');
    if (mods) {
        for (const child of mods.children()) {
            if (child.kind() === 'attribute') {
                decorators.push(child.text());
            }
        }
    }

    // Also check previous siblings (attributes outside modifiers)
    for (const sib of node.prevAll()) {
        if (sib.kind() === 'attribute') {
            decorators.push(sib.text());
        }
    }

    return [...new Set(decorators)];
}

/** Extract parameters text from a Swift function or init node. */
function swiftParams(node: SgNode): string {
    const params = node.children().filter((c) => c.kind() === 'parameter');
    if (params.length === 0) {
        return '()';
    }
    const paramTexts = params.map((p) => p.text());
    return `(${paramTexts.join(', ')})`;
}

/** Extract return type from a Swift function node. */
function swiftReturnType(node: SgNode): string {
    // Look for user_type or optional_type after '->'
    const children = node.children();
    let afterArrow = false;
    for (const child of children) {
        if (child.kind() === '->') {
            afterArrow = true;
            continue;
        }
        if (afterArrow) {
            const k = child.kind();
            if (
                k === 'user_type' ||
                k === 'optional_type' ||
                k === 'tuple_type' ||
                k === 'array_type' ||
                k === 'dictionary_type'
            ) {
                return child.text();
            }
        }
    }
    return '';
}

/** Extract method signatures from a protocol body. */
function swiftProtocolMethods(node: SgNode): string[] {
    const body = node.children().find((c) => c.kind() === 'protocol_body');
    if (!body) {
        return [];
    }

    const methods: string[] = [];
    for (const child of body.children()) {
        if (child.kind() === 'protocol_function_declaration') {
            const name = child.children().find((c) => c.kind() === 'simple_identifier');
            if (name) {
                methods.push(name.text());
            }
        }
    }
    return methods;
}

// ---------------------------------------------------------------------------
// Swift extractor
// ---------------------------------------------------------------------------

export const swiftExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes (class_declaration where kind is 'class') ────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const swKind = swiftClassKind(node);
            if (swKind !== 'class' && swKind !== 'struct') {
                continue;
            }

            const name = swiftTypeName(node);
            if (!name) {
                continue;
            }

            let extendsVal = '';
            const raw = swiftExtends(node);
            if (typeof raw === 'string') {
                extendsVal = raw;
            }

            let implementsVal: string[] = [];
            const rawImpl = swiftImplements(node);
            if (Array.isArray(rawImpl)) {
                implementsVal = rawImpl;
            }

            const classModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsVal,
                implements: implementsVal,
                ast_kind: String(node.kind()),
                modifiers: classModifiers,
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, swiftExportRules),
                decorators: swiftDecorators(node),
            });
        }

        // ── Interfaces (protocol_declaration) ──────────────────────────
        for (const node of root.findAll({ rule: { kind: 'protocol_declaration' } })) {
            const name = swiftTypeName(node);
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.interfaces.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                methods: swiftProtocolMethods(node),
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, swiftExportRules),
            });
        }

        // ── Enums (class_declaration where kind is 'enum') ─────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const swKind = swiftClassKind(node);
            if (swKind !== 'enum') {
                continue;
            }
            const name = swiftTypeName(node);
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.enums.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, swiftExportRules),
            });
        }

        // ── Functions / Methods (function_declaration) ─────────────────
        for (const node of root.findAll({ rule: { kind: 'function_declaration' } })) {
            const name = swiftFuncName(node);
            if (!name) {
                continue;
            }

            let className = '';
            const classAncestor = node.ancestors().find((a: SgNode) => {
                const k = String(a.kind());
                return k === 'class_declaration' || k === 'protocol_declaration';
            });
            if (classAncestor) {
                className = swiftTypeName(classAncestor) || '';
            }

            const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

            // Test detection
            const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or');

            const funcModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                params: swiftParams(node),
                returnType: swiftReturnType(node),
                kind,
                ast_kind: String(node.kind()),
                className,
                modifiers: funcModifiers,
                content_hash: computeContentHash(node.text()),
                isTest,
                is_exported: isExported(name, node, swiftExportRules),
                is_async: isAsync(node),
                decorators: swiftDecorators(node),
                throws: swiftThrows(node),
                complexity: computeCyclomatic(node, SWIFT_BRANCH_KINDS),
            });
        }

        // ── Init declarations (constructors) ───────────────────────────
        for (const node of root.findAll({ rule: { kind: 'init_declaration' } })) {
            let className = '';
            const classAncestor = node.ancestors().find((a: SgNode) => {
                const k = String(a.kind());
                return k === 'class_declaration';
            });
            if (classAncestor) {
                className = swiftTypeName(classAncestor) || '';
            }

            const funcModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.functions.push({
                name: 'init',
                line_start: range.line_start,
                line_end: range.line_end,
                params: swiftParams(node),
                returnType: '',
                kind: 'Constructor',
                ast_kind: String(node.kind()),
                className,
                modifiers: funcModifiers,
                content_hash: computeContentHash(node.text()),
                isTest: false,
                is_exported: isExported('init', node, swiftExportRules),
                is_async: isAsync(node),
                decorators: swiftDecorators(node),
                throws: swiftThrows(node),
                complexity: computeCyclomatic(node, SWIFT_BRANCH_KINDS),
            });
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'import_declaration' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: [module],
                lang: 'swift',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        const findEnclosingClass = (node: SgNode): SgNode | null => {
            return (
                node.ancestors().find((a) => {
                    const k = String(a.kind());
                    return k === 'class_declaration';
                }) ?? null
            );
        };

        const config: CallExtractionConfig = {
            selfPrefixes: ['self.'],
            superPrefixes: ['super.'],
            findEnclosingClass,
            getParentClass: (classNode) => {
                const specifiers = classNode.children().filter((c) => c.kind() === 'inheritance_specifier');
                if (specifiers.length > 0) {
                    const userType = specifiers[0].children().find((c) => c.kind() === 'user_type');
                    return userType
                        ?.children()
                        .find((c) => c.kind() === 'type_identifier')
                        ?.text();
                }
                return undefined;
            },
        };
        extractCalls(root, fp, config, calls);
    },
};

// Receiver-type inference: `let x = Foo()` (call_expression),
// `let y: Bar = ...` (type_annotation).
function extractReceiverTypesSwift(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const pd of root.findAll({ rule: { kind: 'property_declaration' } })) {
        const kids = pd.children();
        // `pattern` → first simple_identifier inside.
        const pattern = kids.find((c: SgNode) => c.kind() === 'pattern');
        const name = pattern
            ?.children()
            .find((c: SgNode) => c.kind() === 'simple_identifier')
            ?.text();
        if (!name) {
            continue;
        }
        const typeAnn = kids.find((c: SgNode) => c.kind() === 'type_annotation');
        let typeName: string | undefined;
        if (typeAnn) {
            const uti = typeAnn
                .children()
                .find((c: SgNode) => c.kind() === 'user_type' || c.kind() === 'type_identifier');
            typeName = uti?.text();
        }
        if (!typeName) {
            const call = kids.find((c: SgNode) => c.kind() === 'call_expression');
            const fnId = call?.children().find((c: SgNode) => c.kind() === 'simple_identifier');
            if (fnId && /^[A-Z]/.test(fnId.text())) {
                typeName = fnId.text();
            }
        }
        if (typeName) {
            bindings.set(name, typeName);
        }
    }
    for (const ce of root.findAll({ rule: { kind: 'call_expression' } })) {
        const nav = ce.children().find((c: SgNode) => c.kind() === 'navigation_expression');
        if (!nav) {
            continue;
        }
        const base = nav.children().find((c: SgNode) => c.kind() === 'simple_identifier');
        if (!base) {
            continue;
        }
        const typeName = bindings.get(base.text());
        if (!typeName) {
            continue;
        }
        const r = ce.range().start;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }
    return out;
}

registerExtractor('swift', swiftExtractors);
registerReceiverTypes('swift', extractReceiverTypesSwift);

// Capabilities: async/await, attributes (`@Published`, `@objc`), throws/do-catch
// exceptions, static types, nominal protocols.
registerCapabilities('swift', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});
