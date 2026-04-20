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
    extractThrows,
    hasTestAnnotation,
    nodeRange,
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for C# cyclomatic complexity.
// `switch_section` is the per-case kind (skip outer `switch_statement`).
// `if_statement` alone covers `else if` (nested if in alternative).
// `conditional_access_expression` is `?.` (short-circuiting) which adds a
// branch.
const CSHARP_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'switch_section',
    'catch_clause',
    'conditional_expression',
    'conditional_access_expression',
] as const;

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function csharpExtends(node: SgNode): string | undefined {
    const baseList = node.children().find((c: SgNode) => c.kind() === 'base_list');
    if (!baseList) {
        return undefined;
    }
    const types = baseList
        .children()
        .filter((c: SgNode) => c.kind() === 'type_identifier' || c.kind() === 'identifier')
        .map((c: SgNode) => c.text());
    // First non-interface name is the base class (C# convention: interfaces start with I+uppercase)
    return types.find((t) => !(t.length >= 2 && t[0] === 'I' && t[1] === t[1].toUpperCase()));
}

function csharpImplements(node: SgNode): string[] {
    const baseList = node.children().find((c: SgNode) => c.kind() === 'base_list');
    if (!baseList) {
        return [];
    }
    const types = baseList
        .children()
        .filter((c: SgNode) => c.kind() === 'type_identifier' || c.kind() === 'identifier')
        .map((c: SgNode) => c.text());
    // Names matching I+uppercase convention are interfaces
    return types.filter((t) => t.length >= 2 && t[0] === 'I' && t[1] === t[1].toUpperCase());
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
// C#-specific helpers
// ---------------------------------------------------------------------------

/** Check if a C# node has 'public' modifier. C# tree-sitter uses 'modifier' kind nodes. */
function csharpIsExported(node: SgNode): boolean {
    return node.children().some((c) => String(c.kind()) === 'modifier' && c.text() === 'public');
}

/** Check if a C# node has 'async' modifier. */
function csharpIsAsync(node: SgNode): boolean {
    return node.children().some((c) => String(c.kind()) === 'modifier' && c.text() === 'async');
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const ANNOTATION_KIND = 'attribute';
const ANNOTATION_NAMES = ['TestMethod', 'Fact', 'Test', 'Theory'];

// ---------------------------------------------------------------------------
// C# extractor
// ---------------------------------------------------------------------------

export const csharpExtractors: LanguageExtractors = {
    extract(root: SgNode, _fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes ──────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            const extendsVal = csharpExtends(node) || '';

            let implementsVal: string[] = [];
            const rawImpl = csharpImplements(node);
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
                is_exported: csharpIsExported(node),
                decorators: extractDecorators(node, ['attribute_list']),
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'interface_declaration' } })) {
            const name = node.field('name')?.text();
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
                is_exported: csharpIsExported(node),
            });
        }

        // ── Enums ───────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'enum_declaration' } })) {
            const name = node.field('name')?.text();
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
                is_exported: csharpIsExported(node),
            });
        }

        // ── Functions / Methods / Constructors ──────────────────────────
        const funcKinds = ['method_declaration', 'constructor_declaration'];
        const constructorKindSet = new Set(['constructor_declaration']);
        const methodKindSet = new Set(['method_declaration']);

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) {
                    continue;
                }

                let className = '';
                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                if (classAncestor) {
                    className = classAncestor.field('name')?.text() || '';
                }

                let kind: 'Function' | 'Method' | 'Constructor';
                if (constructorKindSet.has(funcKind)) {
                    kind = 'Constructor';
                } else if (methodKindSet.has(funcKind) || className) {
                    kind = 'Method';
                } else {
                    kind = 'Function';
                }

                // Test detection
                const isTest = hasTestAnnotation(node, ANNOTATION_KIND, ANNOTATION_NAMES);

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
                    is_exported: csharpIsExported(node),
                    is_async: csharpIsAsync(node),
                    decorators: extractDecorators(node, ['attribute_list']),
                    throws: extractThrows(node, ['throw_statement']),
                    complexity: computeCyclomatic(node, CSHARP_BRANCH_KINDS),
                });
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'using_directive' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'csharp',
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
            superPrefixes: ['base.'],
            findEnclosingClass,
            getParentClass: (classNode) => {
                const bl = classNode.children().find((c) => c.kind() === 'base_list');
                return bl
                    ?.children()
                    .find((c) => c.kind() === 'identifier' || c.kind() === 'type_identifier')
                    ?.text();
            },
        };
        extractCalls(root, fp, config, calls);
    },
};

// Receiver-type inference: `Foo x = new Foo()` (explicit type),
// `var x = new Foo()` (implicit type — take from object_creation_expression).
function extractReceiverTypesCsharp(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const vdWrap of root.findAll({ rule: { kind: 'variable_declaration' } })) {
        const first = vdWrap.children()[0];
        // `Foo x = ...` → explicit; `var x = ...` → first child kind is `implicit_type`.
        const declaredType =
            first && (first.kind() === 'identifier' || first.kind() === 'type_identifier') ? first.text() : undefined;
        for (const vd of vdWrap.children()) {
            if (vd.kind() !== 'variable_declarator') {
                continue;
            }
            const name = vd
                .children()
                .find((c: SgNode) => c.kind() === 'identifier')
                ?.text();
            if (!name) {
                continue;
            }
            let typeName: string | undefined = declaredType;
            if (!typeName) {
                const oce = vd.children().find((c: SgNode) => c.kind() === 'object_creation_expression');
                if (oce) {
                    typeName =
                        oce.field('type')?.text() ??
                        oce
                            .children()
                            .find((c: SgNode) => c.kind() === 'identifier' || c.kind() === 'type_identifier')
                            ?.text();
                }
            }
            if (typeName) {
                bindings.set(name, typeName);
            }
        }
    }
    for (const inv of root.findAll({ rule: { kind: 'invocation_expression' } })) {
        const fn = inv.field('function');
        if (!fn || fn.kind() !== 'member_access_expression') {
            continue;
        }
        const expr = fn.field('expression') ?? fn.children()[0];
        if (!expr || expr.kind() !== 'identifier') {
            continue;
        }
        const typeName = bindings.get(expr.text());
        if (!typeName) {
            continue;
        }
        const r = inv.range().start;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }
    return out;
}

registerExtractor('csharp', csharpExtractors);
registerReceiverTypes('csharp', extractReceiverTypesCsharp);

// Capabilities: async/await + Task, attributes, try/catch exceptions,
// static types, nominal interfaces.
registerCapabilities('csharp', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});

// DI heuristic: `IFoo` → `Foo` (canonical C# interface naming convention).
function csharpDiHeuristics(typeName: string): string[] {
    if (typeName.length > 1 && typeName[0] === 'I' && typeName[1] === typeName[1].toUpperCase()) {
        return [typeName.substring(1)];
    }
    return [];
}

registerDIHeuristics('csharp', csharpDiHeuristics);
