import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import { extractDecorators, extractModifiers, extractThrows, isAsync, isExported } from '../shared';
import type {
    ExtractedClass,
    ExtractedDI,
    ExtractedEnum,
    ExtractedFunction,
    ExtractedImport,
    ExtractedInterface,
    ExtractedReExport,
    ExtractionResult,
    LanguageExtractors,
} from '../spec';
import { TS_FIELDS, TS_KINDS } from './kinds';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const EXPORT_RULES = { exportKeywords: [TS_KINDS.exportStatement, TS_KINDS.exportKeyword] } as const;
const DECORATOR_KINDS = ['decorator'] as const;
const THROW_KINDS = ['throw_statement'] as const;

// Branch kinds for TS/JS cyclomatic complexity.
// Notes on double-counting avoidance:
// - `switch_case` (case-level) only; skip `switch_statement` — outer switch + per-case would N+1.
// - `if_statement` alone covers else-if chains (elif is nested if_statement in alternative).
const TS_BRANCH_KINDS = [
    TS_KINDS.ifStatement,
    TS_KINDS.forStatement,
    TS_KINDS.forInStatement,
    TS_KINDS.whileStatement,
    TS_KINDS.doStatement,
    TS_KINDS.switchCase,
    TS_KINDS.catchClause,
    TS_KINDS.ternaryExpression,
] as const;

// ---------------------------------------------------------------------------
// Core extraction (returns ExtractionResult directly)
// ---------------------------------------------------------------------------

function extractTS(rootNode: SgNode, fp: string, isTS: boolean): ExtractionResult {
    const seen = new Set<string>();

    const classes: ExtractedClass[] = [];
    const functions: ExtractedFunction[] = [];
    const imports: ExtractedImport[] = [];
    const reExports: ExtractedReExport[] = [];
    const interfaces: ExtractedInterface[] = [];
    const enums: ExtractedEnum[] = [];
    const diEntries: ExtractedDI[] = [];

    // ── Classes ──
    const classKinds = isTS
        ? [TS_KINDS.classDeclaration, TS_KINDS.abstractClassDeclaration]
        : [TS_KINDS.classDeclaration];
    for (const kind of classKinds) {
        for (const node of rootNode.findAll({ rule: { kind } })) {
            const name = node.field(TS_FIELDS.name)?.text();
            if (!name || seen.has(`c:${fp}:${name}`)) {
                continue;
            }
            seen.add(`c:${fp}:${name}`);

            let extendsName = '';
            let implementsNames: string[] = [];
            const heritage = node.children().find((c: SgNode) => c.kind() === TS_KINDS.classHeritage);
            if (heritage) {
                const ext = heritage.children().find((c: SgNode) => c.kind() === TS_KINDS.extendsClause);
                extendsName =
                    ext
                        ?.children()
                        .find(
                            (c: SgNode) =>
                                c.kind() === TS_KINDS.identifier ||
                                c.kind() === TS_KINDS.typeIdentifier ||
                                c.kind() === TS_KINDS.memberExpression,
                        )
                        ?.text() || '';
                const impl = heritage.children().find((c: SgNode) => c.kind() === TS_KINDS.implementsClause);
                implementsNames =
                    impl
                        ?.children()
                        .filter((c: SgNode) => c.kind() === TS_KINDS.typeIdentifier || c.kind() === TS_KINDS.identifier)
                        .map((c: SgNode) => c.text()) ?? [];
            }

            classes.push({
                name,
                line_start: node.range().start.line,
                line_end: node.range().end.line,
                extends: extendsName,
                implements: implementsNames,
                modifiers: extractModifiers(node),
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, EXPORT_RULES),
                decorators: extractDecorators(node, [...DECORATOR_KINDS]),
            });
        }
    }

    // ── Methods (kind-based: catches constructor, async, getters/setters) ──
    for (const node of rootNode.findAll({ rule: { kind: TS_KINDS.methodDefinition } })) {
        const name = node.field(TS_FIELDS.name)?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`m:${fp}:${name}:${line}`)) {
            continue;
        }
        seen.add(`m:${fp}:${name}:${line}`);

        const classAncestor = node
            .ancestors()
            .find(
                (a: SgNode) =>
                    a.kind() === TS_KINDS.classDeclaration || (isTS && a.kind() === TS_KINDS.abstractClassDeclaration),
            );
        const className = classAncestor?.field(TS_FIELDS.name)?.text() || '';
        const params = node.field(TS_FIELDS.parameters);
        const retType = node.field(TS_FIELDS.returnType)?.text()?.replace(/^:\s*/, '') || '';

        if (name === 'constructor' && className) {
            // Constructor DI extraction
            if (params) {
                for (const p of params.children()) {
                    if (p.kind() !== TS_KINDS.requiredParameter) {
                        continue;
                    }
                    if (!p.children().some((c: SgNode) => c.kind() === TS_KINDS.accessibilityModifier)) {
                        continue;
                    }
                    const ident = p.children().find((c: SgNode) => c.kind() === TS_KINDS.identifier);
                    const typeAnn = p.children().find((c: SgNode) => c.kind() === TS_KINDS.typeAnnotation);
                    if (ident && typeAnn) {
                        const typeNode = typeAnn
                            .children()
                            .find(
                                (c: SgNode) =>
                                    c.kind() === TS_KINDS.typeIdentifier ||
                                    c.kind() === TS_KINDS.identifier ||
                                    c.kind() === TS_KINDS.genericType,
                            );
                        if (typeNode) {
                            const typeName =
                                typeNode.kind() === TS_KINDS.genericType
                                    ? typeNode
                                          .children()
                                          .find((c: SgNode) => c.kind() === TS_KINDS.typeIdentifier)
                                          ?.text() || typeNode.text()
                                    : typeNode.text();
                            diEntries.push({ fieldName: ident.text(), typeName });
                        }
                    }
                }
            }

            functions.push({
                name: `${className}.constructor`,
                line_start: line,
                line_end: node.range().end.line,
                params: params?.text() || '()',
                returnType: '',
                kind: 'Constructor',
                className,
                modifiers: extractModifiers(node),
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                isTest: false,
                is_exported: isExported(className, classAncestor || node, EXPORT_RULES),
                is_async: false,
                decorators: extractDecorators(node, [...DECORATOR_KINDS]),
                throws: extractThrows(node, [...THROW_KINDS]),
                complexity: computeCyclomatic(node, TS_BRANCH_KINDS),
            });
        } else {
            functions.push({
                name,
                line_start: line,
                line_end: node.range().end.line,
                params: params?.text() || '()',
                returnType: retType,
                kind: className ? 'Method' : 'Function',
                className,
                modifiers: extractModifiers(node),
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                isTest: false,
                is_exported: className
                    ? isExported(className, classAncestor || node, EXPORT_RULES)
                    : isExported(name, node, EXPORT_RULES),
                is_async: isAsync(node),
                decorators: extractDecorators(node, [...DECORATOR_KINDS]),
                throws: extractThrows(node, [...THROW_KINDS]),
                complexity: computeCyclomatic(node, TS_BRANCH_KINDS),
            });
        }
    }

    // ── Standalone functions ──
    for (const node of rootNode.findAll({ rule: { kind: TS_KINDS.functionDeclaration } })) {
        const name = node.field(TS_FIELDS.name)?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`f:${fp}:${name}:${line}`)) {
            continue;
        }
        if (
            node
                .ancestors()
                .some(
                    (a: SgNode) =>
                        a.kind() === TS_KINDS.classDeclaration ||
                        (isTS && a.kind() === TS_KINDS.abstractClassDeclaration),
                )
        ) {
            continue;
        }
        seen.add(`f:${fp}:${name}:${line}`);

        functions.push({
            name,
            line_start: line,
            line_end: node.range().end.line,
            params: node.field(TS_FIELDS.parameters)?.text() || '()',
            returnType: node.field(TS_FIELDS.returnType)?.text()?.replace(/^:\s*/, '') || '',
            kind: 'Function',
            className: '',
            modifiers: extractModifiers(node),
            ast_kind: String(node.kind()),
            content_hash: computeContentHash(node.text()),
            isTest: false,
            is_exported: isExported(name, node, EXPORT_RULES),
            is_async: isAsync(node),
            decorators: extractDecorators(node, [...DECORATOR_KINDS]),
            throws: extractThrows(node, [...THROW_KINDS]),
            complexity: computeCyclomatic(node, TS_BRANCH_KINDS),
        });
    }

    // ── Arrow functions ──
    for (const node of rootNode.findAll({
        rule: { kind: TS_KINDS.variableDeclarator, has: { kind: TS_KINDS.arrowFunction } },
    })) {
        const name = node.field(TS_FIELDS.name)?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`f:${fp}:${name}:${line}`)) {
            continue;
        }
        seen.add(`f:${fp}:${name}:${line}`);

        const arrow = node.children().find((c: SgNode) => c.kind() === TS_KINDS.arrowFunction);
        functions.push({
            name,
            line_start: line,
            line_end: node.range().end.line,
            params: arrow?.field(TS_FIELDS.parameters)?.text() || '()',
            returnType: arrow?.field(TS_FIELDS.returnType)?.text()?.replace(/^:\s*/, '') || '',
            kind: 'Function',
            className: '',
            modifiers: '',
            ast_kind: 'arrow_function',
            content_hash: computeContentHash(node.text()),
            isTest: false,
            is_exported: isExported(name, node, EXPORT_RULES),
            is_async: arrow ? isAsync(arrow) : false,
            decorators: [],
            throws: arrow ? extractThrows(arrow, [...THROW_KINDS]) : [],
            complexity: computeCyclomatic(arrow ?? node, TS_BRANCH_KINDS),
        });
    }

    // ── Interfaces (TS only — JS grammar has no interface_declaration) ──
    if (isTS) {
        for (const node of rootNode.findAll({ rule: { kind: TS_KINDS.interfaceDeclaration } })) {
            const name = node.field(TS_FIELDS.name)?.text();
            if (!name || seen.has(`i:${fp}:${name}`)) {
                continue;
            }
            seen.add(`i:${fp}:${name}`);

            const methods: string[] = [];
            const body = node.field(TS_FIELDS.body);
            if (body) {
                for (const child of body.findAll({ rule: { kind: TS_KINDS.methodSignature } })) {
                    const mn = child.field(TS_FIELDS.name)?.text();
                    if (mn) {
                        methods.push(mn);
                    }
                }
            }

            interfaces.push({
                name,
                line_start: node.range().start.line,
                line_end: node.range().end.line,
                methods,
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, EXPORT_RULES),
            });
        }
    }

    // ── Enums (TS only — JS grammar has no enum_declaration) ──
    if (isTS) {
        for (const node of rootNode.findAll({ rule: { kind: TS_KINDS.enumDeclaration } })) {
            const name = node.field(TS_FIELDS.name)?.text();
            if (!name || seen.has(`e:${fp}:${name}`)) {
                continue;
            }
            seen.add(`e:${fp}:${name}`);
            enums.push({
                name,
                line_start: node.range().start.line,
                line_end: node.range().end.line,
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, EXPORT_RULES),
            });
        }
    }

    // ── Imports ──
    for (const node of rootNode.findAll({ rule: { kind: TS_KINDS.importStatement } })) {
        const sourceNode = node.children().find((c: SgNode) => c.kind() === TS_KINDS.string);
        const frag = sourceNode?.children().find((c: SgNode) => c.kind() === TS_KINDS.stringFragment);
        const modulePath = frag?.text() || sourceNode?.text()?.replace(/['"]/g, '') || '';
        if (!modulePath) {
            continue;
        }

        const names: string[] = [];
        const importClause = node.children().find((c: SgNode) => c.kind() === TS_KINDS.importClause);
        if (importClause) {
            for (const child of importClause.children()) {
                if (child.kind() === TS_KINDS.identifier) {
                    names.push(child.text());
                } else if (child.kind() === TS_KINDS.namedImports) {
                    for (const spec of child.findAll({ rule: { kind: TS_KINDS.importSpecifier } })) {
                        const n =
                            spec.field(TS_FIELDS.name)?.text() ||
                            spec
                                .children()
                                .find((c: SgNode) => c.kind() === TS_KINDS.identifier)
                                ?.text();
                        if (n) {
                            names.push(n);
                        }
                    }
                } else if (child.kind() === TS_KINDS.namespaceImport) {
                    const alias = child.children().find((c: SgNode) => c.kind() === TS_KINDS.identifier);
                    if (alias) {
                        names.push(alias.text());
                    }
                }
            }
        }
        imports.push({
            module: modulePath,
            line: node.range().start.line,
            names,
            lang: 'ts',
        });
    }

    // ── Re-exports ──
    for (const node of rootNode.findAll({ rule: { kind: TS_KINDS.exportStatement } })) {
        const src = node.children().find((c: SgNode) => c.kind() === TS_KINDS.string);
        if (src) {
            const frag = src.children().find((c: SgNode) => c.kind() === TS_KINDS.stringFragment);
            reExports.push({
                module: frag?.text() || src.text().replace(/['"]/g, ''),
                line: node.range().start.line,
            });
        }
    }

    // ── Tests (pattern-based) ──
    for (const p of [
        'describe("$NAME", $$$BODY)',
        "describe('$NAME', $$$BODY)",
        'it("$NAME", $$$BODY)',
        "it('$NAME', $$$BODY)",
        'test("$NAME", $$$BODY)',
        "test('$NAME', $$$BODY)",
    ]) {
        for (const m of rootNode.findAll(p)) {
            const name = m.getMatch('NAME')?.text();
            if (!name) {
                continue;
            }
            const key = `t:${fp}:${name}:${m.range().start.line}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            // Emit test blocks as functions with isTest=true so the engine
            // creates graph.tests entries.
            // Skip if an identical function was already extracted at the same location.
            const duplicate = functions.some((f) => f.name === name && f.line_start === m.range().start.line);
            if (!duplicate) {
                functions.push({
                    name,
                    line_start: m.range().start.line,
                    line_end: m.range().end.line,
                    params: '',
                    returnType: '',
                    kind: 'Function',
                    className: '',
                    modifiers: '',
                    ast_kind: String(m.kind()),
                    content_hash: computeContentHash(m.text()),
                    isTest: true,
                    is_exported: false,
                    is_async: false,
                    decorators: [],
                    throws: [],
                    complexity: computeCyclomatic(m, TS_BRANCH_KINDS),
                });
            }
        }
    }

    // Module-scope value bindings — `export const db = new Database();` lets
    // a different file resolving `db.query()` look this up cross-file. We use
    // the file-root scope (no isFunctionScope) so only top-level / module
    // declarations are captured. Both real types (`Database`) and deferred
    // markers (`@CALLEE:createDb`) flow through the same map.
    const fileBindings = collectBindings(rootNode);
    const valueBindings = Array.from(fileBindings.entries()).map(([name, type]) => ({ name, type }));

    return { classes, functions, imports, reExports, interfaces, enums, diEntries, valueBindings };
}

// ---------------------------------------------------------------------------
// TypeScript-specific call extraction config for shared extractCalls()
// ---------------------------------------------------------------------------

const TS_CALL_CONFIG: CallExtractionConfig = {
    selfPrefixes: ['this.'],
    superPrefixes: ['super.'],
    findEnclosingClass: (node) => {
        return (
            node
                .ancestors()
                .find(
                    (a: SgNode) =>
                        a.kind() === TS_KINDS.classDeclaration || a.kind() === TS_KINDS.abstractClassDeclaration,
                ) ?? null
        );
    },
    getParentClass: (classNode) => {
        const heritage = classNode.children().find((c: SgNode) => c.kind() === TS_KINDS.classHeritage);
        const ext = heritage?.children().find((c: SgNode) => c.kind() === TS_KINDS.extendsClause);
        return ext
            ?.children()
            .find(
                (c: SgNode) =>
                    c.kind() === TS_KINDS.identifier ||
                    c.kind() === TS_KINDS.typeIdentifier ||
                    c.kind() === TS_KINDS.memberExpression,
            )
            ?.text();
    },
    // Skip this.field.method — already handled by the DI pattern
    skipCallee: (callee) => callee.startsWith('this.') && callee.substring(5).includes('.'),
};

function extractCallsTS(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
    // DI pattern: this.$FIELD.$METHOD($$$ARGS)
    // Noise is NOT filtered here — the resolver applies it after the
    // receiver-type tier so user-domain calls survive to be resolved.
    for (const m of rootNode.findAll('this.$FIELD.$METHOD($$$ARGS)')) {
        const field = m.getMatch('FIELD')?.text();
        const methodNode = m.getMatch('METHOD');
        const method = methodNode?.text();
        if (!method || !methodNode) {
            continue;
        }
        // Column = end of method name (≈ col of `(`). Same convention as
        // shared/extract-calls.ts so chained calls have distinct columns.
        const r = methodNode.range().end;
        calls.push({
            source: fp,
            callName: method,
            line: r.line,
            column: r.column,
            diField: field,
        });
    }

    // Direct calls + self/super detection via shared function
    extractCalls(rootNode, fp, TS_CALL_CONFIG, calls);

    // JSX element calls — `<UserCard ... />` or `<UserCard>...</UserCard>` is
    // semantically a call to the component function/class. Without this React
    // codebases have a huge gap in the call graph: every component invocation
    // is invisible. Heuristic: PascalCase tag = component (not HTML element).
    //
    // Only `.tsx` / `.jsx` files have JSX kinds in the grammar; querying the
    // kind in plain `.ts` / `.js` throws `InvalidKind`. Gate by extension.
    if (/\.(tsx|jsx)$/i.test(fp)) {
        for (const kind of [TS_KINDS.jsxSelfClosingElement, TS_KINDS.jsxOpeningElement]) {
            for (const el of rootNode.findAll({ rule: { kind } })) {
                const nameNode =
                    el.field(TS_FIELDS.name) ??
                    el.children().find((c: SgNode) => {
                        const k = String(c.kind());
                        return k === TS_KINDS.identifier || k === TS_KINDS.jsxNamespaceName;
                    });
                const name = nameNode?.text();
                if (!name) {
                    continue;
                }
                // Skip lowercase-tag HTML elements (`div`, `span`, `button`, …)
                // and namespaced/member tags (`svg:rect`, `Foo.Bar`).
                if (!/^[A-Z][A-Za-z0-9_$]*$/.test(name)) {
                    continue;
                }
                const r = (nameNode ?? el).range().end;
                calls.push({
                    source: fp,
                    callName: name,
                    line: r.line,
                    column: r.column,
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Backward-compat export used by tests/parser/call-extraction.test.ts
// ---------------------------------------------------------------------------

/**
 * Extract raw call sites from a TypeScript/JavaScript AST.
 * Finds DI calls (this.field.method) and direct calls ($CALLEE($$$ARGS)).
 * Does NOT filter noise or resolve — noise is applied by the resolver after
 * the receiver-type tier.
 */
export function extractCallsFromTypeScript(root: SgRoot, fp: string, calls: RawCallSite[]): void {
    extractCallsTS(root.root(), fp, calls);
}

// ---------------------------------------------------------------------------
// LanguageExtractors implementations
// ---------------------------------------------------------------------------

function createTsExtractors(isTS: boolean): LanguageExtractors {
    return {
        extract(rootNode: SgNode, fp: string): ExtractionResult {
            return extractTS(rootNode, fp, isTS);
        },
        extractCalls(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
            extractCallsTS(rootNode, fp, calls);
        },
        extractReceiverTypes(rootNode: SgNode, fp: string): ReceiverTypeMap {
            return extractReceiverTypesTS(rootNode, fp);
        },
    };
}

// ---------------------------------------------------------------------------
// Receiver-type inference (scope-local, two-pass)
// ---------------------------------------------------------------------------

/**
 * Extract the unqualified type name from a TS `new Foo()` or
 * `new foo.Foo<T>()` expression. Returns `undefined` for anything
 * we can't confidently name.
 */
function typeFromNewExpression(newExpr: SgNode): string | undefined {
    const cons = newExpr.field(TS_FIELDS.constructor);
    if (!cons) {
        return undefined;
    }
    const k = cons.kind();
    if (k === TS_KINDS.identifier || k === TS_KINDS.typeIdentifier) {
        return cons.text();
    }
    // `new pkg.Foo()` — take the final member
    if (k === TS_KINDS.memberExpression) {
        const prop = cons.field(TS_FIELDS.property);
        return prop?.text();
    }
    return undefined;
}

/** Extract a type name from a `: Foo` type_annotation. */
function typeFromAnnotation(typeAnn: SgNode): string | undefined {
    const typeNode = typeAnn
        .children()
        .find(
            (c: SgNode) =>
                c.kind() === TS_KINDS.typeIdentifier ||
                c.kind() === TS_KINDS.identifier ||
                c.kind() === TS_KINDS.genericType,
        );
    if (!typeNode) {
        return undefined;
    }
    if (typeNode.kind() === TS_KINDS.genericType) {
        return (
            typeNode
                .children()
                .find((c: SgNode) => c.kind() === TS_KINDS.typeIdentifier)
                ?.text() ?? undefined
        );
    }
    return typeNode.text();
}

/**
 * Collect variable-to-type bindings within a given scope (function body or
 * file root). Only tracks explicit type annotations and `new` expressions —
 * we deliberately do NOT attempt to infer from arbitrary expressions.
 *
 * When `scope` is a function-like node (function/method/arrow), the function's
 * top-level typed parameters are also seeded into the bindings map. This lets
 * `repo.find()` inside `function handle(repo: UserRepo) { ... }` resolve at
 * the receiver tier.
 */
function collectBindings(scopeNode: SgNode, isFunctionScope = false): Map<string, string> {
    const bindings = new Map<string, string>();
    for (const vd of scopeNode.findAll({ rule: { kind: TS_KINDS.variableDeclarator } })) {
        const nameNode = vd.children().find((c: SgNode) => c.kind() === TS_KINDS.identifier);
        const name = nameNode?.text();
        if (!name) {
            continue;
        }
        const typeAnn = vd.children().find((c: SgNode) => c.kind() === TS_KINDS.typeAnnotation);
        const newExpr = vd.children().find((c: SgNode) => c.kind() === TS_KINDS.newExpression);
        const asExpr = vd.children().find((c: SgNode) => c.kind() === TS_KINDS.asExpression);
        let typeName: string | undefined;
        if (typeAnn) {
            typeName = typeFromAnnotation(typeAnn);
        }
        if (!typeName && newExpr) {
            typeName = typeFromNewExpression(newExpr);
        }
        // Type assertion: `const x = something() as Foo` — pull the type from
        // the as_expression's type child. Useful when the LHS has no explicit
        // annotation but the dev is forcing a known type at runtime.
        if (!typeName && asExpr) {
            const typeChild = asExpr
                .children()
                .find((c: SgNode) => c.kind() === TS_KINDS.typeIdentifier || c.kind() === TS_KINDS.genericType);
            if (typeChild) {
                typeName =
                    typeChild.kind() === TS_KINDS.genericType
                        ? (typeChild
                              .children()
                              .find((c: SgNode) => c.kind() === TS_KINDS.typeIdentifier)
                              ?.text() ?? typeChild.text())
                        : typeChild.text();
            }
        }
        // Deferred factory binding: `const x = factory()` with no explicit
        // type annotation. We can't resolve `factory`'s return type at extract
        // time (cross-file), so we emit a `@CALLEE:factory` marker and let the
        // resolver substitute the real type at resolve time using the global
        // returnTypes map.
        if (!typeName) {
            const callExpr = vd.children().find((c: SgNode) => c.kind() === TS_KINDS.callExpression);
            const fnNode = callExpr?.field(TS_FIELDS.function);
            if (fnNode?.kind() === TS_KINDS.identifier) {
                const calleeName = fnNode.text();
                // Skip lowercase-only names that are clearly noise (e.g. `log`,
                // `print`) — those won't have user-domain return types anyway.
                // Track all real call patterns; the resolver gracefully falls
                // through when no return type exists.
                typeName = `@CALLEE:${calleeName}`;
            }
        }
        if (typeName) {
            bindings.set(name, typeName);
        }
    }
    if (isFunctionScope) {
        seedTSParamBindings(scopeNode, bindings);
    }
    return bindings;
}

/**
 * Walk a function-like node's immediate parameter list and seed each typed
 * parameter into bindings. Handles `required_parameter` and `optional_parameter`
 * (TS) and identifier-only patterns inside `formal_parameters` (JS).
 */
function seedTSParamBindings(fnNode: SgNode, bindings: Map<string, string>): void {
    const params =
        fnNode.field(TS_FIELDS.parameters) ??
        fnNode.children().find((c: SgNode) => c.kind() === TS_KINDS.formalParameters);
    if (!params) {
        return;
    }
    for (const p of params.children()) {
        const kind = p.kind();
        if (kind !== TS_KINDS.requiredParameter && kind !== TS_KINDS.optionalParameter) {
            continue;
        }
        const pattern =
            p.field(TS_FIELDS.pattern) ?? p.children().find((c: SgNode) => c.kind() === TS_KINDS.identifier);
        const name = pattern?.kind() === TS_KINDS.identifier ? pattern.text() : undefined;
        if (!name) {
            continue;
        }
        const typeAnn = p.children().find((c: SgNode) => c.kind() === TS_KINDS.typeAnnotation);
        if (!typeAnn) {
            continue;
        }
        const typeName = typeFromAnnotation(typeAnn);
        if (typeName) {
            bindings.set(name, typeName);
        }
    }
}

function extractReceiverTypesTS(rootNode: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    // File-level bindings act as fallbacks for top-level method calls.
    const fileBindings = collectBindings(rootNode);
    // Per-function bindings override file-level ones inside the function body.
    const functionKinds = [
        TS_KINDS.functionDeclaration,
        TS_KINDS.methodDefinition,
        TS_KINDS.arrowFunction,
        TS_KINDS.functionExpression,
    ];
    const functionRanges: { node: SgNode; bindings: Map<string, string> }[] = [];
    for (const kind of functionKinds) {
        for (const fn of rootNode.findAll({ rule: { kind } })) {
            functionRanges.push({ node: fn, bindings: collectBindings(fn, true) });
        }
    }
    // For each member_expression used as a call receiver, find the innermost
    // enclosing function whose binding matches `x`. Fall back to file scope.
    for (const ce of rootNode.findAll({ rule: { kind: TS_KINDS.callExpression } })) {
        const fnField = ce.field(TS_FIELDS.function);
        if (!fnField || fnField.kind() !== TS_KINDS.memberExpression) {
            continue;
        }
        const objectNode = fnField.field(TS_FIELDS.object);
        if (!objectNode || objectNode.kind() !== TS_KINDS.identifier) {
            continue;
        }
        const receiver = objectNode.text();
        // Walk function ranges inside-out using node ranges as a cheap scope test.
        const callRange = ce.range();
        let typeName: string | undefined;
        // Prefer the innermost function — iterate in reverse of discovery order
        // where innermost functions are encountered after their outer parent.
        // Since ast-grep findAll is document-order, innermost shows up later
        // ONLY for siblings; for nesting we need containment test.
        let bestSize = Infinity;
        for (const { node, bindings } of functionRanges) {
            const nr = node.range();
            if (nr.start.index > callRange.start.index || nr.end.index < callRange.end.index) {
                continue;
            }
            const size = nr.end.index - nr.start.index;
            if (size < bestSize && bindings.has(receiver)) {
                typeName = bindings.get(receiver);
                bestSize = size;
            }
        }
        if (!typeName) {
            typeName = fileBindings.get(receiver);
        }
        // Static method call heuristic: PascalCase receiver with no binding match
        // is treated as a class reference. `Logger.warn()` → receiverType='Logger'.
        // The receiver tier validates against the symbol table; if `Logger.warn`
        // isn't a real method, the tier returns null and we fall through.
        if (!typeName && /^[A-Z][A-Za-z0-9_]*$/.test(receiver)) {
            typeName = receiver;
        }
        // Cross-file value-binding deferred marker: lowercase identifier with
        // no scope-local match — likely an imported value like `db` or `cache`.
        // The resolver looks up the import path and consults the global
        // valueBindings map for the source file. Falls through gracefully
        // when the receiver isn't actually imported.
        if (!typeName && /^[a-z_$][A-Za-z0-9_$]*$/.test(receiver)) {
            typeName = `@IMPORT:${receiver}`;
        }
        if (!typeName) {
            continue;
        }
        // Column convention: end-of-function (≈ col of `(` of args). Matches
        // the call extractor so chained calls don't collide on receiver-type
        // lookup. See src/shared/extract-calls.ts.
        const r = (ce.field(TS_FIELDS.function) ?? ce).range().end;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }
    return out;
}

const tsExtractors = createTsExtractors(true);
const jsExtractors = createTsExtractors(false);

// Register with the exact strings that getLanguageName / Lang enum produce.
// Lang.TypeScript === "TypeScript", Lang.Tsx === "Tsx", Lang.JavaScript === "JavaScript"
registerExtractor('TypeScript', tsExtractors);
registerExtractor('Tsx', tsExtractors);
registerExtractor('JavaScript', jsExtractors);

// Capabilities: TS/Tsx share structural interfaces, decorators (stage-3), async/await,
// try/catch. JavaScript shares all semantics except it is dynamically typed.
const TS_CAPS = {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'structural' as const,
};
registerCapabilities('TypeScript', TS_CAPS);
registerCapabilities('Tsx', TS_CAPS);
registerCapabilities('JavaScript', { ...TS_CAPS, hasStaticTypes: false });

// DI heuristic: `IFoo` → `Foo` (TS/JS community convention; also applies to
// idiomatic JSDoc-typed JS code). Second char must be uppercase to avoid
// stripping the `I` from names like `Iterator`.
function tsDiHeuristics(typeName: string): string[] {
    if (typeName.length > 1 && typeName[0] === 'I' && typeName[1] === typeName[1].toUpperCase()) {
        return [typeName.substring(1)];
    }
    return [];
}

registerDIHeuristics('TypeScript', tsDiHeuristics);
registerDIHeuristics('Tsx', tsDiHeuristics);
registerDIHeuristics('JavaScript', tsDiHeuristics);

// Receiver-type inference: scope-local bindings from `const x = new Foo()` /
// `const x: Foo = ...`. JS uses the same algorithm — type annotations don't
// exist there, so `new` expressions are the only signal; registering for JS
// is still useful for that half.
registerReceiverTypes('TypeScript', extractReceiverTypesTS);
registerReceiverTypes('Tsx', extractReceiverTypesTS);
registerReceiverTypes('JavaScript', extractReceiverTypesTS);
