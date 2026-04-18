import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor } from '../engine';
import { computeContentHash, emptyResult, extractModifiers, isTestByNaming, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { DART_NOISE } from './noise';

// Branch kinds for Dart cyclomatic complexity.
// Empirically verified: Dart uses `switch_label` (NOT `case_statement`) as
// the per-case kind. `if_statement` alone covers `else if`. Dart has two
// `for_statement` forms (classic + for-in) but both share the kind.
const DART_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'while_statement',
    'do_statement',
    'switch_label',
    'catch_clause',
    'conditional_expression',
] as const;

/**
 * Dart `method_signature` / `function_signature` nodes contain only the
 * signature; the body lives in a sibling `function_body`. Compute complexity
 * against the body (if present) since branching statements live there.
 */
function dartComplexityRoot(sigNode: SgNode): SgNode {
    const nextSib = sigNode.next();
    if (nextSib && nextSib.kind() === 'function_body') {
        return nextSib;
    }
    return sigNode;
}

// ---------------------------------------------------------------------------
// Dart naming helpers
// ---------------------------------------------------------------------------

/**
 * Get the name from an `identifier` child node.
 */
function dartName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'identifier')
        ?.text();
}

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

/**
 * Extract the superclass from a class_definition's `superclass` child.
 * Dart: `class Foo extends Bar with Baz` — the `superclass` node contains
 * `extends Bar` (and optionally `with Mixin`).
 */
function dartExtends(node: SgNode): string | undefined {
    const superclass = node.children().find((c) => c.kind() === 'superclass');
    if (!superclass) {
        return undefined;
    }
    const typeId = superclass.children().find((c) => c.kind() === 'type_identifier');
    return typeId?.text();
}

/**
 * Extract implemented interfaces from a class_definition's `interfaces` child.
 * Dart: `class Foo implements Bar, Baz`
 */
function dartImplements(node: SgNode): string[] {
    const interfaces = node.children().find((c) => c.kind() === 'interfaces');
    if (!interfaces) {
        return [];
    }
    return interfaces
        .children()
        .filter((c) => c.kind() === 'type_identifier')
        .map((c) => c.text());
}

/**
 * Extract mixins from a class_definition's superclass `mixins` child.
 * Dart: `class Foo extends Bar with Mixin1, Mixin2`
 * The `mixins` node lives inside the `superclass` node.
 */
function dartMixins(node: SgNode): string[] {
    const superclass = node.children().find((c) => c.kind() === 'superclass');
    if (superclass) {
        const mixins = superclass.children().find((c) => c.kind() === 'mixins');
        if (mixins) {
            return mixins
                .children()
                .filter((c) => c.kind() === 'type_identifier')
                .map((c) => c.text());
        }
    }
    return [];
}

// ---------------------------------------------------------------------------
// Export detection
// ---------------------------------------------------------------------------

/**
 * In Dart, names starting with `_` are library-private (not exported).
 * Everything else is public.
 */
function dartIsExported(name: string): boolean {
    return !name.startsWith('_');
}

// ---------------------------------------------------------------------------
// Async detection
// ---------------------------------------------------------------------------

/**
 * Check if a Dart function/method is async.
 * Looks for `async` keyword in the sibling `function_body` node,
 * or for `Future` return type in the function_signature.
 */
function dartIsAsync(node: SgNode): boolean {
    // For method_signature nodes, look at the next sibling (function_body)
    const nextSib = node.next();
    if (nextSib && nextSib.kind() === 'function_body') {
        if (nextSib.children().some((c) => c.kind() === 'async')) {
            return true;
        }
    }

    // Check for Future return type
    const funcSig =
        node.kind() === 'function_signature' ? node : node.children().find((c) => c.kind() === 'function_signature');
    if (funcSig) {
        const returnType = funcSig.children().find((c) => c.kind() === 'type_identifier');
        if (returnType && returnType.text() === 'Future') {
            return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Decorator/annotation extraction
// ---------------------------------------------------------------------------

/**
 * Extract annotations from Dart nodes.
 * Dart has `marker_annotation` (@override, @protected) and
 * `annotation` (@Deprecated('msg')) as previous siblings.
 */
function dartDecorators(node: SgNode): string[] {
    const decorators: string[] = [];

    for (const sib of node.prevAll()) {
        const k = sib.kind();
        if (k === 'marker_annotation' || k === 'annotation') {
            decorators.push(sib.text());
        }
    }

    return [...new Set(decorators)];
}

// ---------------------------------------------------------------------------
// Parameter and return type helpers
// ---------------------------------------------------------------------------

function dartParams(node: SgNode): string {
    const funcSig =
        node.kind() === 'function_signature' ? node : node.children().find((c) => c.kind() === 'function_signature');
    if (!funcSig) {
        return '()';
    }
    const params = funcSig.children().find((c) => c.kind() === 'formal_parameter_list');
    return params ? params.text() : '()';
}

function dartReturnType(node: SgNode): string {
    const funcSig =
        node.kind() === 'function_signature' ? node : node.children().find((c) => c.kind() === 'function_signature');
    if (!funcSig) {
        return '';
    }

    const children = funcSig.children();
    // Return type is the first type_identifier or void_type before the function name
    for (const child of children) {
        const k = child.kind();
        if (k === 'type_identifier' || k === 'void_type') {
            return child.text();
        }
        if (k === 'identifier') {
            break; // reached the function name without finding a return type
        }
    }
    return '';
}

// ---------------------------------------------------------------------------
// Method extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract method signatures from an abstract class body.
 * In Dart, abstract class methods appear as `declaration` > `function_signature`
 * (without a function_body).
 */
function dartAbstractMethods(node: SgNode): string[] {
    const body = node.children().find((c) => c.kind() === 'class_body');
    if (!body) {
        return [];
    }

    const methods: string[] = [];
    for (const child of body.children()) {
        if (child.kind() === 'declaration') {
            const funcSig = child.children().find((c) => c.kind() === 'function_signature');
            if (funcSig) {
                const name = funcSig.children().find((c) => c.kind() === 'identifier');
                if (name) {
                    methods.push(name.text());
                }
            }
        }
    }
    return methods;
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const FILE_PATTERNS = [/_test\.dart$/, /test_.*\.dart$/];
const FUNC_PATTERNS = [/^test/];

// ---------------------------------------------------------------------------
// Dart extractor
// ---------------------------------------------------------------------------

export const dartExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes (class_definition — non-abstract) ──────────────────
        for (const node of root.findAll({ rule: { kind: 'class_definition' } })) {
            const isAbstract = node.children().some((c) => c.kind() === 'abstract');

            // Abstract classes are treated as interfaces
            if (isAbstract) {
                const name = dartName(node);
                if (!name) {
                    continue;
                }

                const range = nodeRange(node);
                result.interfaces.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    methods: dartAbstractMethods(node),
                    ast_kind: String(node.kind()),
                    content_hash: computeContentHash(node.text()),
                    is_exported: dartIsExported(name),
                });
                continue;
            }

            const name = dartName(node);
            if (!name) {
                continue;
            }

            const extendsVal = dartExtends(node) || '';
            const implementsVal = dartImplements(node);
            const mixins = dartMixins(node);
            // Append mixins to implements for full heritage picture
            const allImplements = [...implementsVal, ...mixins];

            const classModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsVal,
                implements: allImplements,
                ast_kind: String(node.kind()),
                modifiers: classModifiers,
                content_hash: computeContentHash(node.text()),
                is_exported: dartIsExported(name),
                decorators: dartDecorators(node),
            });
        }

        // ── Mixins (mixin_declaration) ────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'mixin_declaration' } })) {
            const name = dartName(node);
            if (!name) {
                continue;
            }

            // Mixins can have `on` constraints (superclass requirements)
            const onTypes: string[] = [];
            let foundOn = false;
            for (const child of node.children()) {
                if (child.kind() === 'on') {
                    foundOn = true;
                    continue;
                }
                if (foundOn && child.kind() === 'type_identifier') {
                    onTypes.push(child.text());
                    foundOn = false;
                }
                if (child.kind() === 'class_body') {
                    break;
                }
            }

            const range = nodeRange(node);
            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: '',
                implements: onTypes, // "on BaseClass" as constraint
                ast_kind: String(node.kind()),
                modifiers: 'mixin',
                content_hash: computeContentHash(node.text()),
                is_exported: dartIsExported(name),
                decorators: dartDecorators(node),
            });
        }

        // ── Enums (enum_declaration) ──────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'enum_declaration' } })) {
            const name = dartName(node);
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
                is_exported: dartIsExported(name),
            });
        }

        // ── Methods (method_signature inside class_body) ──────────────
        for (const node of root.findAll({ rule: { kind: 'method_signature' } })) {
            const funcSig = node.children().find((c) => c.kind() === 'function_signature');
            // Also handle factory_constructor_signature, getter_signature, setter_signature
            const factorySig = node.children().find((c) => c.kind() === 'factory_constructor_signature');
            const getterSig = node.children().find((c) => c.kind() === 'getter_signature');
            const setterSig = node.children().find((c) => c.kind() === 'setter_signature');

            let name: string | undefined;
            let params = '()';
            let returnType = '';
            let isStatic = false;

            if (funcSig) {
                name = funcSig
                    .children()
                    .find((c) => c.kind() === 'identifier')
                    ?.text();
                params = dartParams(funcSig);
                returnType = dartReturnType(funcSig);
                isStatic = node.children().some((c) => c.kind() === 'static');
            } else if (factorySig) {
                // Factory constructor: factory Foo.create()
                const ids = factorySig.children().filter((c) => c.kind() === 'identifier');
                name = ids.length >= 2 ? `${ids[0].text()}.${ids[1].text()}` : ids[0]?.text();
                const fparams = factorySig.children().find((c) => c.kind() === 'formal_parameter_list');
                params = fparams ? fparams.text() : '()';
            } else if (getterSig) {
                name = getterSig
                    .children()
                    .find((c) => c.kind() === 'identifier')
                    ?.text();
                returnType = dartReturnType(getterSig);
            } else if (setterSig) {
                name = setterSig
                    .children()
                    .find((c) => c.kind() === 'identifier')
                    ?.text();
                const sparams = setterSig.children().find((c) => c.kind() === 'formal_parameter_list');
                params = sparams ? sparams.text() : '()';
            }

            if (!name) {
                continue;
            }

            // Find enclosing class
            let className = '';
            const classAncestor = node.ancestors().find((a: SgNode) => {
                const k = String(a.kind());
                return k === 'class_definition' || k === 'mixin_declaration' || k === 'extension_declaration';
            });
            if (classAncestor) {
                className = dartName(classAncestor) || '';
            }

            const kind: 'Function' | 'Method' | 'Constructor' = factorySig ? 'Constructor' : 'Method';
            const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or');

            // Build modifiers string
            const modParts: string[] = [];
            if (isStatic) {
                modParts.push('static');
            }
            const existingMods = extractModifiers(node);
            if (existingMods) {
                modParts.push(existingMods);
            }

            const range = nodeRange(node);

            // Get the full text including the function_body (next sibling)
            const nextSib = node.next();
            const fullText =
                nextSib && nextSib.kind() === 'function_body' ? `${node.text()} ${nextSib.text()}` : node.text();

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: nextSib && nextSib.kind() === 'function_body' ? nextSib.range().end.line : range.line_end,
                params,
                returnType,
                kind,
                ast_kind: String(node.kind()),
                className,
                modifiers: modParts.join(' '),
                content_hash: computeContentHash(fullText),
                isTest,
                is_exported: dartIsExported(name),
                is_async: dartIsAsync(node),
                decorators: dartDecorators(node),
                throws: [], // Dart has no throws clause
                complexity: computeCyclomatic(dartComplexityRoot(node), DART_BRANCH_KINDS),
            });
        }

        // ── Constructors (constructor_signature inside declaration) ────
        for (const node of root.findAll({ rule: { kind: 'constructor_signature' } })) {
            const name = node
                .children()
                .find((c) => c.kind() === 'identifier')
                ?.text();
            if (!name) {
                continue;
            }

            // Find enclosing class
            let className = '';
            const classAncestor = node.ancestors().find((a: SgNode) => {
                const k = String(a.kind());
                return k === 'class_definition';
            });
            if (classAncestor) {
                className = dartName(classAncestor) || '';
            }

            const params = node.children().find((c) => c.kind() === 'formal_parameter_list');
            const range = nodeRange(node);

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                params: params ? params.text() : '()',
                returnType: '',
                kind: 'Constructor',
                ast_kind: String(node.kind()),
                className,
                modifiers: '',
                content_hash: computeContentHash(node.text()),
                isTest: false,
                is_exported: dartIsExported(name),
                is_async: false,
                decorators: [],
                throws: [],
                complexity: computeCyclomatic(dartComplexityRoot(node), DART_BRANCH_KINDS),
            });
        }

        // ── Top-level functions (function_signature at program level) ─
        for (const node of root.findAll({ rule: { kind: 'function_signature' } })) {
            // Skip function_signatures inside method_signature, declaration, etc.
            const parent = node.parent();
            if (parent && (parent.kind() === 'method_signature' || parent.kind() === 'declaration')) {
                continue;
            }

            const name = node
                .children()
                .find((c) => c.kind() === 'identifier')
                ?.text();
            if (!name) {
                continue;
            }

            // Make sure it's not inside a class body (abstract method declarations)
            const inClassBody = node.ancestors().some((a: SgNode) => a.kind() === 'class_body');
            if (inClassBody) {
                continue;
            }

            const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or');
            const range = nodeRange(node);

            // Get the function_body (next sibling)
            const nextSib = node.next();
            const hasBody = nextSib && nextSib.kind() === 'function_body';
            const fullText = hasBody ? `${node.text()} ${nextSib.text()}` : node.text();

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: hasBody ? nextSib.range().end.line : range.line_end,
                params: dartParams(node),
                returnType: dartReturnType(node),
                kind: 'Function',
                ast_kind: String(node.kind()),
                className: '',
                modifiers: '',
                content_hash: computeContentHash(fullText),
                isTest,
                is_exported: dartIsExported(name),
                is_async: dartIsAsync(node),
                decorators: dartDecorators(node),
                throws: [],
                complexity: computeCyclomatic(dartComplexityRoot(node), DART_BRANCH_KINDS),
            });
        }

        // ── Imports (import_or_export) ─────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'import_or_export' } })) {
            const uriNode = node.findAll({ rule: { kind: 'uri' } })[0];
            if (!uriNode) {
                continue;
            }

            // Strip quotes from URI
            const rawUri = uriNode.text().replace(/^['"]|['"]$/g, '');
            if (!rawUri) {
                continue;
            }

            result.imports.push({
                module: rawUri,
                line: node.range().start.line,
                names: [rawUri],
                lang: 'dart',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        const findEnclosingClass = (node: SgNode): SgNode | null => {
            return (
                node.ancestors().find((a) => {
                    const k = String(a.kind());
                    return k === 'class_definition' || k === 'mixin_declaration';
                }) ?? null
            );
        };

        const config: CallExtractionConfig = {
            selfPrefixes: ['this.'],
            superPrefixes: ['super.'],
            findEnclosingClass,
            getParentClass: (classNode) => {
                const superclass = classNode.children().find((c) => c.kind() === 'superclass');
                if (superclass) {
                    const typeId = superclass.children().find((c) => c.kind() === 'type_identifier');
                    return typeId?.text();
                }
                return undefined;
            },
            noise: DART_NOISE,
        };
        extractCalls(root, fp, config, calls);
    },
};

registerExtractor('dart', dartExtractors);

// Capabilities: async/await + Futures, metadata annotations (`@override`),
// try/catch exceptions, static+sound null-safe types, nominal interfaces.
registerCapabilities('dart', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});
