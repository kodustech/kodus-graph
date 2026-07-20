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
    stripImportKeyword,
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { CSHARP_FIELDS, CSHARP_KINDS } from './kinds';

// Branch kinds for C# cyclomatic complexity.
// `switch_section` is the per-case kind (skip outer `switch_statement`).
// `if_statement` alone covers `else if` (nested if in alternative).
// `conditional_access_expression` is `?.` (short-circuiting) which adds a
// branch.
const CSHARP_BRANCH_KINDS = [
    CSHARP_KINDS.ifStatement,
    CSHARP_KINDS.forStatement,
    CSHARP_KINDS.foreachStatement,
    CSHARP_KINDS.whileStatement,
    CSHARP_KINDS.doStatement,
    CSHARP_KINDS.switchSection,
    CSHARP_KINDS.catchClause,
    CSHARP_KINDS.conditionalExpression,
    CSHARP_KINDS.conditionalAccessExpression,
] as const;

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function csharpExtends(node: SgNode): string | undefined {
    const baseList = node.children().find((c: SgNode) => c.kind() === CSHARP_KINDS.baseList);
    if (!baseList) {
        return undefined;
    }
    const types = baseList
        .children()
        .filter((c: SgNode) => c.kind() === CSHARP_KINDS.identifier)
        .map((c: SgNode) => c.text());
    // First non-interface name is the base class (C# convention: interfaces start with I+uppercase)
    return types.find((t) => !(t.length >= 2 && t[0] === 'I' && t[1] === t[1].toUpperCase()));
}

function csharpImplements(node: SgNode): string[] {
    const baseList = node.children().find((c: SgNode) => c.kind() === CSHARP_KINDS.baseList);
    if (!baseList) {
        return [];
    }
    const types = baseList
        .children()
        .filter((c: SgNode) => c.kind() === CSHARP_KINDS.identifier)
        .map((c: SgNode) => c.text());
    // Names matching I+uppercase convention are interfaces
    return types.filter((t) => t.length >= 2 && t[0] === 'I' && t[1] === t[1].toUpperCase());
}

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    for (const child of node.children()) {
        if (child.kind() === CSHARP_KINDS.qualifiedName) {
            return child.text();
        }
    }

    for (const child of node.children()) {
        if (child.kind() === CSHARP_KINDS.identifier) {
            return child.text();
        }
    }

    return stripImportKeyword(node);
}

function extractImportNames(node: SgNode): string[] {
    const names: string[] = [];
    for (const child of node.children()) {
        if (child.kind() === CSHARP_KINDS.identifier) {
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
    return node.children().some((c) => String(c.kind()) === CSHARP_KINDS.modifier && c.text() === 'public');
}

/** Check if a C# node has 'async' modifier. */
function csharpIsAsync(node: SgNode): boolean {
    return node.children().some((c) => String(c.kind()) === CSHARP_KINDS.modifier && c.text() === 'async');
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const ANNOTATION_KIND = CSHARP_KINDS.attribute;
const ANNOTATION_NAMES = ['TestMethod', 'Fact', 'Test', 'Theory'];

// ---------------------------------------------------------------------------
// DI extraction helpers
// ---------------------------------------------------------------------------

// Primitive C# types we deliberately exclude from DI bindings — they are not
// services and would only add noise to the diMap.
const CSHARP_PRIMITIVE_KINDS = new Set<string>([CSHARP_KINDS.predefinedType]);

/**
 * Extract a (typeName, declaratorName) pair from a tree-sitter `parameter`
 * node. C# represents `IFoo foo` as two consecutive `identifier` children
 * (no field name on the type), so we read positionally.
 */
function csharpParamTypeAndName(p: SgNode): { typeName: string; name: string } | null {
    if (p.kind() !== CSHARP_KINDS.parameter) {
        return null;
    }
    let typeNode: SgNode | undefined;
    let nameNode: SgNode | undefined;
    for (const c of p.children()) {
        const k = c.kind();
        if (k === CSHARP_KINDS.attributeList || k === CSHARP_KINDS.modifier) {
            continue;
        }
        if (
            k === CSHARP_KINDS.identifier ||
            k === CSHARP_KINDS.genericName ||
            k === CSHARP_KINDS.qualifiedName ||
            k === CSHARP_KINDS.predefinedType ||
            k === CSHARP_KINDS.nullableType ||
            k === CSHARP_KINDS.arrayType
        ) {
            if (!typeNode) {
                typeNode = c;
            } else if (!nameNode) {
                nameNode = c;
            }
        }
    }
    if (!typeNode || !nameNode || CSHARP_PRIMITIVE_KINDS.has(String(typeNode.kind()))) {
        return null;
    }
    const typeName = unwrapCsharpType(typeNode);
    return typeName ? { typeName, name: nameNode.text() } : null;
}

/** Unwrap `IFoo<Bar>` → `IFoo`, `IFoo?` → `IFoo`, `IFoo` → `IFoo`. */
function unwrapCsharpType(typeNode: SgNode): string {
    const k = typeNode.kind();
    if (k === CSHARP_KINDS.genericName) {
        return (
            typeNode
                .children()
                .find((c) => c.kind() === CSHARP_KINDS.identifier)
                ?.text() ?? typeNode.text()
        );
    }
    if (k === CSHARP_KINDS.nullableType) {
        const inner = typeNode
            .children()
            .find((c) => c.kind() === CSHARP_KINDS.identifier || c.kind() === CSHARP_KINDS.genericName);
        return inner ? unwrapCsharpType(inner) : typeNode.text();
    }
    if (k === CSHARP_KINDS.arrayType) {
        return typeNode.text();
    }
    return typeNode.text();
}

/**
 * Iterate constructor declarations inside a class/record body. Used to
 * gate "single-ctor implicit DI" — every typed param of the sole ctor in a
 * managed class becomes a diEntry, mirroring how Microsoft.Extensions.DI
 * resolves ctor params at runtime.
 */
function csharpConstructorsIn(classNode: SgNode): SgNode[] {
    const body = classNode.children().find((c) => c.kind() === CSHARP_KINDS.declarationList);
    if (!body) {
        return [];
    }
    return body.children().filter((c) => c.kind() === CSHARP_KINDS.constructorDeclaration);
}

/** Find the immediate `parameter_list` child of a class/record (primary ctor). */
function csharpPrimaryCtorParams(classNode: SgNode): SgNode | null {
    return classNode.children().find((c) => c.kind() === CSHARP_KINDS.parameterList) ?? null;
}

// ---------------------------------------------------------------------------
// C# extractor
// ---------------------------------------------------------------------------

export const csharpExtractors: LanguageExtractors = {
    extract(root: SgNode, _fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes ──────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: CSHARP_KINDS.classDeclaration } })) {
            const name = node.field(CSHARP_FIELDS.name)?.text();
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
                decorators: extractDecorators(node, [CSHARP_KINDS.attributeList]),
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: CSHARP_KINDS.interfaceDeclaration } })) {
            const name = node.field(CSHARP_FIELDS.name)?.text();
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
        for (const node of root.findAll({ rule: { kind: CSHARP_KINDS.enumDeclaration } })) {
            const name = node.field(CSHARP_FIELDS.name)?.text();
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
        const funcKinds = [CSHARP_KINDS.methodDeclaration, CSHARP_KINDS.constructorDeclaration];
        const constructorKindSet = new Set<string>([CSHARP_KINDS.constructorDeclaration]);
        const methodKindSet = new Set<string>([CSHARP_KINDS.methodDeclaration]);

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field(CSHARP_FIELDS.name)?.text();
                if (!name) {
                    continue;
                }

                let className = '';
                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                if (classAncestor) {
                    className = classAncestor.field(CSHARP_FIELDS.name)?.text() || '';
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
                    params: node.field(CSHARP_FIELDS.parameters)?.text() || '()',
                    // C# tree-sitter exposes the return type as `returns` field.
                    returnType: node.field(CSHARP_FIELDS.returns)?.text() || '',
                    kind,
                    ast_kind: String(node.kind()),
                    className,
                    modifiers: funcModifiers,
                    content_hash: computeContentHash(node.text()),
                    isTest,
                    is_exported: csharpIsExported(node),
                    is_async: csharpIsAsync(node),
                    decorators: extractDecorators(node, [CSHARP_KINDS.attributeList]),
                    throws: extractThrows(node, [CSHARP_KINDS.throwStatement]),
                    complexity: computeCyclomatic(node, CSHARP_BRANCH_KINDS),
                });
            }
        }

        // ── DI: typed fields, properties, ctor params ───────────────────
        // .NET DI is implicit-by-default: Microsoft.Extensions.DependencyInjection
        // resolves every ctor param against the registered IServiceCollection.
        // Mirroring that, we treat typed instance fields, typed properties,
        // single-ctor params, and primary-ctor params as DI bindings — the
        // graph then routes `this.Repo.FindAll()` and analogous patterns
        // through the DI tier (0.9) instead of falling to cascade.
        //
        // Why everything-typed (not just `[Inject]`-annotated): real-world
        // .NET code rarely annotates fields. Lombok-style "all fields are
        // injected" is the common shape — assign in ctor, mark as readonly,
        // never use `[Inject]`. Indexing all typed fields catches that path
        // at the cost of indexing non-DI fields too, which is harmless: the
        // resolver only consults diMap when the call shape is `this.field.method()`.

        // Field injection
        for (const fd of root.findAll({ rule: { kind: CSHARP_KINDS.fieldDeclaration } })) {
            const vd = fd.children().find((c) => c.kind() === CSHARP_KINDS.variableDeclaration);
            if (!vd) {
                continue;
            }
            const typeNode = vd
                .children()
                .find(
                    (c) =>
                        c.kind() === CSHARP_KINDS.identifier ||
                        c.kind() === CSHARP_KINDS.genericName ||
                        c.kind() === CSHARP_KINDS.qualifiedName,
                );
            if (!typeNode) {
                continue;
            }
            const typeName = unwrapCsharpType(typeNode);
            for (const decl of vd.children()) {
                if (decl.kind() !== CSHARP_KINDS.variableDeclarator) {
                    continue;
                }
                const fieldName = decl
                    .children()
                    .find((c) => c.kind() === CSHARP_KINDS.identifier)
                    ?.text();
                if (!fieldName) {
                    continue;
                }
                result.diEntries.push({ fieldName, typeName });
            }
        }

        // Property injection (Blazor `[Inject]` and conventional auto-props)
        for (const pd of root.findAll({ rule: { kind: CSHARP_KINDS.propertyDeclaration } })) {
            const ids: SgNode[] = [];
            for (const c of pd.children()) {
                const k = c.kind();
                if (
                    k === CSHARP_KINDS.identifier ||
                    k === CSHARP_KINDS.genericName ||
                    k === CSHARP_KINDS.qualifiedName
                ) {
                    ids.push(c);
                }
            }
            if (ids.length < 2) {
                continue;
            }
            const typeName = unwrapCsharpType(ids[0]);
            const propertyName = ids[1].text();
            if (typeName) {
                result.diEntries.push({ fieldName: propertyName, typeName });
            }
        }

        // Constructor injection: when a class has exactly ONE ctor, every typed
        // param is treated as an injected dependency. Mirrors the .NET DI
        // container's runtime behavior — and matches the Java Spring 4.3+ rule.
        for (const cls of root.findAll({ rule: { kind: CSHARP_KINDS.classDeclaration } })) {
            const ctors = csharpConstructorsIn(cls);
            if (ctors.length !== 1) {
                continue;
            }
            const params = ctors[0].field(CSHARP_FIELDS.parameters);
            if (!params) {
                continue;
            }
            for (const p of params.children()) {
                const pair = csharpParamTypeAndName(p);
                if (pair) {
                    result.diEntries.push({ fieldName: pair.name, typeName: pair.typeName });
                }
            }
        }

        // Primary constructor (C# 12+ for classes; C# 9+ for records). The
        // params are auto-promoted to compiler-generated fields/properties
        // accessible inside the body — semantically identical to ctor injection.
        for (const k of [CSHARP_KINDS.classDeclaration, CSHARP_KINDS.recordDeclaration]) {
            for (const cls of root.findAll({ rule: { kind: k } })) {
                const params = csharpPrimaryCtorParams(cls);
                if (!params) {
                    continue;
                }
                for (const p of params.children()) {
                    const pair = csharpParamTypeAndName(p);
                    if (pair) {
                        result.diEntries.push({ fieldName: pair.name, typeName: pair.typeName });
                    }
                }
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: CSHARP_KINDS.usingDirective } })) {
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
                const bl = classNode.children().find((c) => c.kind() === CSHARP_KINDS.baseList);
                return bl
                    ?.children()
                    .find((c) => c.kind() === CSHARP_KINDS.identifier)
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
    for (const vdWrap of root.findAll({ rule: { kind: CSHARP_KINDS.variableDeclaration } })) {
        const first = vdWrap.children()[0];
        // `Foo x = ...` → explicit; `var x = ...` → first child kind is `implicit_type`.
        const declaredType = first && first.kind() === CSHARP_KINDS.identifier ? first.text() : undefined;
        for (const vd of vdWrap.children()) {
            if (vd.kind() !== CSHARP_KINDS.variableDeclarator) {
                continue;
            }
            const name = vd
                .children()
                .find((c: SgNode) => c.kind() === CSHARP_KINDS.identifier)
                ?.text();
            if (!name) {
                continue;
            }
            let typeName: string | undefined = declaredType;
            if (!typeName) {
                const oce = vd.children().find((c: SgNode) => c.kind() === CSHARP_KINDS.objectCreationExpression);
                if (oce) {
                    typeName =
                        oce.field(CSHARP_FIELDS.type)?.text() ??
                        oce
                            .children()
                            .find((c: SgNode) => c.kind() === CSHARP_KINDS.identifier)
                            ?.text();
                }
                // C# `var x = factory();` — emit deferred `@CALLEE:` marker so
                // the resolver substitutes the callee's return type cross-file.
                // Only fires for bare invocation `Foo()` (no receiver).
                if (!typeName) {
                    const inv = vd.children().find((c: SgNode) => c.kind() === CSHARP_KINDS.invocationExpression);
                    const fn = inv?.field(CSHARP_FIELDS.function);
                    if (fn?.kind() === CSHARP_KINDS.identifier) {
                        typeName = `@CALLEE:${fn.text()}`;
                    }
                }
            }
            if (typeName) {
                bindings.set(name, typeName);
            }
        }
    }
    // Method/constructor parameters with explicit types — `void Handle(Repo repo)` —
    // become bindings inside the body so `repo.Find()` resolves at the receiver
    // tier. C# tree-sitter exposes `parameter_list > parameter > [type, identifier]`.
    const seedCsParam = (p: SgNode): void => {
        if (p.kind() !== CSHARP_KINDS.parameter) {
            return;
        }
        const name =
            p.field(CSHARP_FIELDS.name)?.text() ??
            p
                .children()
                .find((c: SgNode) => c.kind() === CSHARP_KINDS.identifier)
                ?.text();
        const typeNode = p.field(CSHARP_FIELDS.type);
        if (!name || !typeNode) {
            return;
        }
        let typeName: string | undefined;
        const tk = typeNode.kind();
        if (tk === CSHARP_KINDS.identifier || tk === CSHARP_KINDS.predefinedType) {
            typeName = typeNode.text();
        } else if (tk === CSHARP_KINDS.genericName) {
            typeName =
                typeNode
                    .children()
                    .find((c: SgNode) => c.kind() === CSHARP_KINDS.identifier)
                    ?.text() ?? typeNode.text();
        } else if (tk === CSHARP_KINDS.nullableType) {
            const inner = typeNode
                .children()
                .find((c: SgNode) => c.kind() === CSHARP_KINDS.identifier || c.kind() === CSHARP_KINDS.genericName);
            typeName =
                inner?.kind() === CSHARP_KINDS.genericName
                    ? inner
                          .children()
                          .find((c: SgNode) => c.kind() === CSHARP_KINDS.identifier)
                          ?.text()
                    : inner?.text();
        }
        if (typeName) {
            bindings.set(name, typeName);
        }
    };
    const CSHARP_FN_KINDS = [
        CSHARP_KINDS.methodDeclaration,
        CSHARP_KINDS.constructorDeclaration,
        CSHARP_KINDS.localFunctionStatement,
    ];
    for (const kind of CSHARP_FN_KINDS) {
        for (const fn of root.findAll({ rule: { kind } })) {
            const params = fn.field(CSHARP_FIELDS.parameters);
            if (!params) {
                continue;
            }
            for (const p of params.children()) {
                seedCsParam(p);
            }
        }
    }

    // Field-as-binding: `_repo.FindAll()` (the dominant .NET pattern is bare
    // access without `this.`). Without this, every field-driven member call
    // falls through to cascade. Mirrors the choice we made in Java DI for
    // bare typed fields — and complements the diEntries pass above so both
    // `this.Repo.X` AND `_repo.X` resolve at high-conf tiers.
    for (const fd of root.findAll({ rule: { kind: CSHARP_KINDS.fieldDeclaration } })) {
        const vd = fd.children().find((c) => c.kind() === CSHARP_KINDS.variableDeclaration);
        if (!vd) {
            continue;
        }
        const typeNode = vd
            .children()
            .find(
                (c) =>
                    c.kind() === CSHARP_KINDS.identifier ||
                    c.kind() === CSHARP_KINDS.genericName ||
                    c.kind() === CSHARP_KINDS.qualifiedName,
            );
        if (!typeNode) {
            continue;
        }
        const typeName = unwrapCsharpType(typeNode);
        for (const decl of vd.children()) {
            if (decl.kind() !== CSHARP_KINDS.variableDeclarator) {
                continue;
            }
            const fieldName = decl
                .children()
                .find((c) => c.kind() === CSHARP_KINDS.identifier)
                ?.text();
            if (fieldName) {
                bindings.set(fieldName, typeName);
            }
        }
    }
    // Properties: same rationale — `Repo.FindAll()` (auto-prop) is bare-access.
    for (const pd of root.findAll({ rule: { kind: CSHARP_KINDS.propertyDeclaration } })) {
        const ids: SgNode[] = [];
        for (const c of pd.children()) {
            const k = c.kind();
            if (k === CSHARP_KINDS.identifier || k === CSHARP_KINDS.genericName || k === CSHARP_KINDS.qualifiedName) {
                ids.push(c);
            }
        }
        if (ids.length < 2) {
            continue;
        }
        const typeName = unwrapCsharpType(ids[0]);
        const propertyName = ids[1].text();
        if (typeName) {
            bindings.set(propertyName, typeName);
        }
    }
    // Primary-ctor params (C# 12+ classes, records since C# 9). The params
    // are visible bare inside every method of the class, so they deserve a
    // binding entry. We seed them at file scope; intra-file namespace clashes
    // between sibling classes are rare enough to ignore.
    for (const k of [CSHARP_KINDS.classDeclaration, CSHARP_KINDS.recordDeclaration]) {
        for (const cls of root.findAll({ rule: { kind: k } })) {
            const params = cls.children().find((c) => c.kind() === CSHARP_KINDS.parameterList);
            if (!params) {
                continue;
            }
            for (const p of params.children()) {
                const pair = csharpParamTypeAndName(p);
                if (pair) {
                    bindings.set(pair.name, pair.typeName);
                }
            }
        }
    }

    for (const inv of root.findAll({ rule: { kind: CSHARP_KINDS.invocationExpression } })) {
        const fn = inv.field(CSHARP_FIELDS.function);
        if (!fn || fn.kind() !== CSHARP_KINDS.memberAccessExpression) {
            continue;
        }
        const expr = fn.field(CSHARP_FIELDS.expression) ?? fn.children()[0];
        if (!expr || expr.kind() !== CSHARP_KINDS.identifier) {
            continue;
        }
        const exprText = expr.text();
        let typeName = bindings.get(exprText);
        // Static method call heuristic: PascalCase receiver = class reference.
        // C# `Console.WriteLine(...)`, `Math.Sqrt(...)` → receiverType=class.
        if (!typeName && /^[A-Z][A-Za-z0-9_]*$/.test(exprText)) {
            typeName = exprText;
        }
        if (!typeName) {
            continue;
        }
        const r = fn.range().end;
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
