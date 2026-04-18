import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
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
    nodeRange,
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { JAVA_NOISE } from './noise';

// Branch kinds for Java cyclomatic complexity.
// `else if` is a nested `if_statement` in the alternative — `if_statement`
// alone suffices. `switch_label` is the case-level kind (skip the outer
// `switch_expression` / `switch_block`). Java has both classic `for_statement`
// and `enhanced_for_statement` (for-each) — both are decisions.
const JAVA_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'enhanced_for_statement',
    'while_statement',
    'do_statement',
    'switch_label',
    'catch_clause',
    'ternary_expression',
] as const;

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
// Heritage helpers
// ---------------------------------------------------------------------------

function javaExtends(node: SgNode): string | undefined {
    const superclass = node.children().find((c: SgNode) => c.kind() === 'superclass');
    if (!superclass) {
        return undefined;
    }
    const typeId = superclass.children().find((c: SgNode) => c.kind() === 'type_identifier');
    return typeId?.text();
}

function javaImplements(node: SgNode): string[] {
    const superInterfaces = node.children().find((c: SgNode) => c.kind() === 'super_interfaces');
    if (!superInterfaces) {
        return [];
    }
    const typeList = superInterfaces.children().find((c: SgNode) => c.kind() === 'type_list');
    const container = typeList || superInterfaces;
    return container
        .children()
        .filter((c: SgNode) => c.kind() === 'type_identifier')
        .map((c: SgNode) => c.text());
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const ANNOTATION_KIND = 'marker_annotation';
const ANNOTATION_NAMES = ['Test', 'ParameterizedTest'];

// ---------------------------------------------------------------------------
// Java extractor
// ---------------------------------------------------------------------------

export const javaExtractors: LanguageExtractors = {
    extract(root: SgNode, _fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes ──────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            let extendsVal = '';
            const raw = javaExtends(node);
            if (typeof raw === 'string') {
                extendsVal = raw;
            }

            let implementsVal: string[] = [];
            const rawImpl = javaImplements(node);
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
                is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
                decorators: extractDecorators(node, ['marker_annotation', 'annotation']),
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
                is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
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
                is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
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

                // Java throws clause: find `throws` child and extract type names
                const javaThrows: string[] = [];
                const throwsClause = node.children().find((c) => String(c.kind()) === 'throws');
                if (throwsClause) {
                    for (const child of throwsClause.children()) {
                        if (String(child.kind()) === 'type_identifier') {
                            javaThrows.push(child.text());
                        }
                    }
                }

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
                    is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
                    is_async: false,
                    decorators: extractDecorators(node, ['marker_annotation', 'annotation']),
                    throws: javaThrows,
                    complexity: computeCyclomatic(node, JAVA_BRANCH_KINDS),
                });
            }
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
                names: extractImportNames(node),
                lang: 'java',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        // Java needs a walk-based extraction rather than the shared
        // `$CALLEE($$$ARGS)` pattern: that pattern only binds to bare
        // `foo(args)` invocations in the tree-sitter-java grammar and drops
        // member calls like `x.method(args)` on the floor (the grammar puts
        // those under a distinct `method_invocation` shape with separate
        // `object` / `name` fields that the pattern parser can't unify).
        // Walking `method_invocation` directly captures both uniformly.

        const getParentClass = (classNode: SgNode): string | undefined => {
            const sc = classNode.children().find((c) => c.kind() === 'superclass');
            return sc
                ?.children()
                .find((c) => c.kind() === 'type_identifier')
                ?.text();
        };

        // Use declaration-kind names rather than substring checks — `class_body`
        // also contains "class" and would shadow the enclosing declaration.
        const CLASS_DECL_KINDS = new Set(['class_declaration', 'record_declaration', 'enum_declaration']);
        const findEnclosingClass = (node: SgNode): SgNode | null =>
            node.ancestors().find((a) => CLASS_DECL_KINDS.has(String(a.kind()))) ?? null;

        for (const mi of root.findAll({ rule: { kind: 'method_invocation' } })) {
            const nameNode = mi.field('name');
            const callName = nameNode?.text();
            if (!callName) {
                continue;
            }
            if (JAVA_NOISE.has(callName)) {
                continue;
            }

            const obj = mi.field('object');
            let resolveInClass: string | undefined;

            if (obj) {
                const objText = obj.text();
                const objKind = obj.kind();
                // `this.method()` — resolve against current class.
                if (objKind === 'this' || objText === 'this') {
                    const classNode = findEnclosingClass(mi);
                    resolveInClass = classNode?.field('name')?.text();
                } else if (objKind === 'super' || objText === 'super') {
                    // `super.method()` — resolve against parent class.
                    const classNode = findEnclosingClass(mi);
                    if (classNode) {
                        resolveInClass = getParentClass(classNode);
                    }
                }
                // For other `x.method()` member calls, `callName` alone is
                // enough — the receiver-type inference pass cross-references
                // by file/line/column to surface `receiverType`.
            }

            const r = mi.range().start;
            calls.push({
                source: fp,
                callName,
                line: r.line,
                column: r.column,
                ...(resolveInClass ? { resolveInClass } : {}),
            });
        }
    },
};

// Receiver-type inference: `Foo x = new Foo()` (explicit type), `var x = new Foo()` (Java 10+).
function extractReceiverTypesJava(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const lvd of root.findAll({ rule: { kind: 'local_variable_declaration' } })) {
        const declaredType = lvd.field('type')?.text();
        for (const vd of lvd.children()) {
            if (vd.kind() !== 'variable_declarator') {
                continue;
            }
            const name = vd.field('name')?.text();
            if (!name) {
                continue;
            }
            let typeName: string | undefined;
            if (declaredType && declaredType !== 'var') {
                typeName = declaredType;
            } else {
                const value = vd.field('value');
                if (value?.kind() === 'object_creation_expression') {
                    typeName = value.field('type')?.text();
                }
            }
            if (typeName) {
                bindings.set(name, typeName);
            }
        }
    }
    for (const mi of root.findAll({ rule: { kind: 'method_invocation' } })) {
        const obj = mi.field('object');
        if (!obj || obj.kind() !== 'identifier') {
            continue;
        }
        const typeName = bindings.get(obj.text());
        if (!typeName) {
            continue;
        }
        const r = mi.range().start;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }
    return out;
}

registerExtractor('java', javaExtractors);
registerReceiverTypes('java', extractReceiverTypesJava);

// Capabilities: CompletableFuture/async (framework-level), annotations,
// checked+unchecked exceptions, static types, nominal interfaces.
registerCapabilities('java', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});

// DI heuristic: bare interface `UserService` → `UserServiceImpl` or
// `DefaultUserService` (dominant Spring/JEE community conventions).
function javaDiHeuristics(typeName: string): string[] {
    return [`${typeName}Impl`, `Default${typeName}`];
}

registerDIHeuristics('java', javaDiHeuristics);
