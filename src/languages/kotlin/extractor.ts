import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import {
    computeContentHash,
    emptyResult,
    extractDecorators,
    extractModifiers,
    hasTestAnnotation,
    isExported,
    isTestByNaming,
    nodeRange,
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for Kotlin cyclomatic complexity.
// `when_entry` is the case-arm kind (skip outer `when_expression`).
// `if_expression` alone covers `else if` (nested if_expression in alternative).
// Kotlin uses `catch_block` (not `catch_clause`).
const KOTLIN_BRANCH_KINDS = [
    'if_expression',
    'for_statement',
    'while_statement',
    'do_while_statement',
    'when_entry',
    'catch_block',
] as const;

// ---------------------------------------------------------------------------
// Kotlin disambiguation helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a Kotlin `class_declaration` node is a class, interface, or enum.
 * In Kotlin's tree-sitter grammar, all three share the `class_declaration` kind
 * and are distinguished by the presence of `interface` or `enum` child tokens.
 */
function kotlinClassKind(node: SgNode): 'class' | 'interface' | 'enum' {
    const children = node.children();
    if (children.some((c) => c.kind() === 'interface')) {
        return 'interface';
    }
    if (children.some((c) => c.kind() === 'enum')) {
        return 'enum';
    }
    return 'class';
}

/**
 * Get the name for a Kotlin `class_declaration` or `object_declaration` node.
 * Kotlin's tree-sitter grammar does not expose `field('name')` -- the name
 * lives in a `type_identifier` child node instead.
 */
function kotlinTypeName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'type_identifier')
        ?.text();
}

/**
 * Get the name for a Kotlin `function_declaration` node.
 * The function name is a `simple_identifier` child (not exposed via `field('name')`).
 */
function kotlinFuncName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'simple_identifier')
        ?.text();
}

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function kotlinExtends(node: SgNode): string | undefined {
    const delegations = node.children().filter((c: SgNode) => c.kind() === 'delegation_specifier');
    for (const d of delegations) {
        const ctorInvocation = d.children().find((c: SgNode) => c.kind() === 'constructor_invocation');
        if (ctorInvocation) {
            const userType = ctorInvocation.children().find((c: SgNode) => c.kind() === 'user_type');
            const typeId = userType?.children().find((c: SgNode) => c.kind() === 'type_identifier');
            if (typeId) {
                return typeId.text();
            }
        }
    }
    return undefined;
}

function kotlinImplements(node: SgNode): string[] {
    const delegations = node.children().filter((c: SgNode) => c.kind() === 'delegation_specifier');
    const interfaces: string[] = [];
    for (const d of delegations) {
        const hasCtorInvocation = d.children().some((c: SgNode) => c.kind() === 'constructor_invocation');
        if (!hasCtorInvocation) {
            const userType = d.children().find((c: SgNode) => c.kind() === 'user_type');
            const typeId = userType?.children().find((c: SgNode) => c.kind() === 'type_identifier');
            if (typeId) {
                interfaces.push(typeId.text());
            }
        }
    }
    return interfaces;
}

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'string' || ck === 'interpreted_string_literal' || ck === 'string_fragment') {
            const raw = child.text();
            return raw.replace(/^["'`]|["'`]$/g, '');
        }
        for (const grandchild of child.children()) {
            const gck = grandchild.kind();
            if (gck === 'string_fragment' || gck === 'string_content') {
                return grandchild.text();
            }
        }
    }

    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'scoped_identifier' || ck === 'scoped_type_identifier' || ck === 'qualified_name') {
            return child.text();
        }
    }

    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'name' || ck === 'namespace_name' || ck === 'use_tree') {
            return child.text();
        }
    }

    for (const child of node.children()) {
        if (child.kind() === 'identifier' || child.kind() === 'type_identifier') {
            return child.text();
        }
    }

    return node
        .text()
        .replace(/^\s*(import|use|using|require)\s+/i, '')
        .replace(/[;{}]/g, '')
        .trim();
}

function extractImportNames(node: SgNode): string[] {
    const names: string[] = [];
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'identifier' || ck === 'type_identifier' || ck === 'name') {
            names.push(child.text());
        }
    }
    return names;
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const FILE_PATTERNS = [/test/i];
const FUNC_PATTERNS = [/^test/i];
const ANNOTATION_KIND = 'annotation';
const ANNOTATION_NAMES = ['Test', 'ParameterizedTest'];

// ---------------------------------------------------------------------------
// Kotlin-specific helpers for new fields
// ---------------------------------------------------------------------------

/** Kotlin is public by default — exported unless private/protected/internal modifier is present. */
const kotlinExportRules = {
    customCheck: (_name: string, node: SgNode) => {
        const mods = extractModifiers(node);
        if (mods.includes('private') || mods.includes('protected') || mods.includes('internal')) {
            return false;
        }
        return true;
    },
};

/** Check if a Kotlin function has `suspend` modifier. */
function kotlinIsAsync(node: SgNode): boolean {
    const mods = extractModifiers(node);
    return mods.includes('suspend');
}

/** Extract throws from Kotlin `@Throws(...)` annotation. */
function kotlinThrows(node: SgNode): string[] {
    const decorators = extractDecorators(node, ['annotation']);
    const throws: string[] = [];
    for (const d of decorators) {
        const match = d.match(/@Throws\(([^)]+)\)/);
        if (match) {
            const types = match[1]
                .split(',')
                .map((t) => t.replace(/::class/g, '').trim())
                .filter(Boolean);
            throws.push(...types);
        }
    }
    return throws;
}

// ---------------------------------------------------------------------------
// Kotlin extractor
// ---------------------------------------------------------------------------

export const kotlinExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes (class_declaration where kind is 'class') ────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const ktKind = kotlinClassKind(node);
            if (ktKind !== 'class') {
                continue;
            }
            const name = kotlinTypeName(node);
            if (!name) {
                continue;
            }

            let extendsVal = '';
            const raw = kotlinExtends(node);
            if (typeof raw === 'string') {
                extendsVal = raw;
            }

            let implementsVal: string[] = [];
            const rawImpl = kotlinImplements(node);
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
                is_exported: isExported(name, node, kotlinExportRules),
                decorators: extractDecorators(node, ['annotation']),
            });
        }

        // ── Classes (object_declaration) ────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'object_declaration' } })) {
            const name = kotlinTypeName(node);
            if (!name) {
                continue;
            }

            let extendsVal = '';
            const raw = kotlinExtends(node);
            if (typeof raw === 'string') {
                extendsVal = raw;
            }

            let implementsVal: string[] = [];
            const rawImpl = kotlinImplements(node);
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
                is_exported: isExported(name, node, kotlinExportRules),
                decorators: extractDecorators(node, ['annotation']),
            });
        }

        // ── Interfaces (class_declaration where kind is 'interface') ────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const ktKind = kotlinClassKind(node);
            if (ktKind !== 'interface') {
                continue;
            }
            const name = kotlinTypeName(node);
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.interfaces.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                methods: [],
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, kotlinExportRules),
            });
        }

        // ── Enums (class_declaration where kind is 'enum') ──────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const ktKind = kotlinClassKind(node);
            if (ktKind !== 'enum') {
                continue;
            }
            const name = kotlinTypeName(node);
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
                is_exported: isExported(name, node, kotlinExportRules),
            });
        }

        // ── Functions / Methods ─────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'function_declaration' } })) {
            const name = kotlinFuncName(node);
            if (!name) {
                continue;
            }

            let className = '';
            const classAncestor = node.ancestors().find((a: SgNode) => {
                const k = String(a.kind());
                return k === 'class_declaration' || k === 'object_declaration';
            });
            if (classAncestor) {
                className = kotlinTypeName(classAncestor) || '';
            }

            const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

            // Test detection
            const isTest =
                isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or') ||
                hasTestAnnotation(node, ANNOTATION_KIND, ANNOTATION_NAMES);

            const funcModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                params: node.field('parameters')?.text() || '()',
                returnType: node.field('return_type')?.text() || '',
                kind,
                ast_kind: String(node.kind()),
                className,
                modifiers: funcModifiers,
                content_hash: computeContentHash(node.text()),
                isTest,
                is_exported: isExported(name, node, kotlinExportRules),
                is_async: kotlinIsAsync(node),
                decorators: extractDecorators(node, ['annotation']),
                throws: kotlinThrows(node),
                complexity: computeCyclomatic(node, KOTLIN_BRANCH_KINDS),
            });
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'import_header' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'kotlin',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        const findEnclosingClass = (node: SgNode): SgNode | null => {
            return (
                node.ancestors().find((a) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                }) ?? null
            );
        };

        const config: CallExtractionConfig = {
            selfPrefixes: ['this.'],
            superPrefixes: ['super.'],
            findEnclosingClass,
            getParentClass: (classNode) => {
                const delegations = classNode.children().filter((c) => c.kind() === 'delegation_specifier');
                for (const d of delegations) {
                    const ctorInvocation = d.children().find((c) => c.kind() === 'constructor_invocation');
                    if (ctorInvocation) {
                        const userType = ctorInvocation.children().find((c) => c.kind() === 'user_type');
                        return userType
                            ?.children()
                            .find((c) => c.kind() === 'type_identifier')
                            ?.text();
                    }
                }
                return undefined;
            },
        };
        extractCalls(root, fp, config, calls);
    },
};

// Receiver-type inference: `val x = Foo()` (constructor-like call),
// `val x: Foo = ...` (explicit type annotation).
function extractReceiverTypesKotlin(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const pd of root.findAll({ rule: { kind: 'property_declaration' } })) {
        const varDecl = pd.children().find((c: SgNode) => c.kind() === 'variable_declaration');
        const name = varDecl
            ?.children()
            .find((c: SgNode) => c.kind() === 'simple_identifier')
            ?.text();
        if (!name) {
            continue;
        }
        // Explicit type annotation: `val y: Bar` — user_type inside variable_declaration.
        const userType = varDecl
            ?.children()
            .find((c: SgNode) => c.kind() === 'user_type')
            ?.text();
        let typeName: string | undefined = userType;
        if (!typeName) {
            // Constructor-like call on RHS: `val x = Foo()` → call_expression with simple_identifier function.
            const call = pd.children().find((c: SgNode) => c.kind() === 'call_expression');
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

registerExtractor('kotlin', kotlinExtractors);
registerReceiverTypes('kotlin', extractReceiverTypesKotlin);

// Capabilities: suspend functions / coroutines (async), annotations, try/catch
// (all unchecked), static types, nominal interfaces. Mirrors Java profile.
registerCapabilities('kotlin', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});

// DI heuristic: Kotlin reuses the Java/Spring convention.
function kotlinDiHeuristics(typeName: string): string[] {
    return [`${typeName}Impl`, `Default${typeName}`];
}

registerDIHeuristics('kotlin', kotlinDiHeuristics);
