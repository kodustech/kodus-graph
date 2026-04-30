import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { LANG_KINDS } from '../../parser/languages';
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

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const EXPORT_RULES = { exportKeywords: ['export_statement', 'export'] } as const;
const DECORATOR_KINDS = ['decorator'] as const;
const THROW_KINDS = ['throw_statement'] as const;

// Branch kinds for TS/JS cyclomatic complexity.
// Notes on double-counting avoidance:
// - `switch_case` (case-level) only; skip `switch_statement` — outer switch + per-case would N+1.
// - `if_statement` alone covers else-if chains (elif is nested if_statement in alternative).
const TS_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
    'ternary_expression',
] as const;

// ---------------------------------------------------------------------------
// Core extraction (returns ExtractionResult directly)
// ---------------------------------------------------------------------------

function extractTS(rootNode: SgNode, fp: string, isTS: boolean): ExtractionResult {
    const kinds = LANG_KINDS.typescript;
    const seen = new Set<string>();

    const classes: ExtractedClass[] = [];
    const functions: ExtractedFunction[] = [];
    const imports: ExtractedImport[] = [];
    const reExports: ExtractedReExport[] = [];
    const interfaces: ExtractedInterface[] = [];
    const enums: ExtractedEnum[] = [];
    const diEntries: ExtractedDI[] = [];

    // ── Classes ──
    const classKinds = isTS ? [kinds.class, kinds.abstractClass] : [kinds.class];
    for (const kind of classKinds) {
        for (const node of rootNode.findAll({ rule: { kind } })) {
            const name = node.field('name')?.text();
            if (!name || seen.has(`c:${fp}:${name}`)) {
                continue;
            }
            seen.add(`c:${fp}:${name}`);

            let extendsName = '';
            let implementsNames: string[] = [];
            const heritage = node.children().find((c: SgNode) => c.kind() === 'class_heritage');
            if (heritage) {
                const ext = heritage.children().find((c: SgNode) => c.kind() === 'extends_clause');
                extendsName =
                    ext
                        ?.children()
                        .find(
                            (c: SgNode) =>
                                c.kind() === 'identifier' ||
                                c.kind() === 'type_identifier' ||
                                c.kind() === 'member_expression',
                        )
                        ?.text() || '';
                const impl = heritage.children().find((c: SgNode) => c.kind() === 'implements_clause');
                implementsNames =
                    impl
                        ?.children()
                        .filter((c: SgNode) => c.kind() === 'type_identifier' || c.kind() === 'identifier')
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
    for (const node of rootNode.findAll({ rule: { kind: kinds.method } })) {
        const name = node.field('name')?.text();
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
            .find((a: SgNode) => a.kind() === kinds.class || (isTS && a.kind() === kinds.abstractClass));
        const className = classAncestor?.field('name')?.text() || '';
        const params = node.field('parameters');
        const retType = node.field('return_type')?.text()?.replace(/^:\s*/, '') || '';

        if (name === 'constructor' && className) {
            // Constructor DI extraction
            if (params) {
                for (const p of params.children()) {
                    if (p.kind() !== 'required_parameter') {
                        continue;
                    }
                    if (!p.children().some((c: SgNode) => c.kind() === 'accessibility_modifier')) {
                        continue;
                    }
                    const ident = p.children().find((c: SgNode) => c.kind() === 'identifier');
                    const typeAnn = p.children().find((c: SgNode) => c.kind() === 'type_annotation');
                    if (ident && typeAnn) {
                        const typeNode = typeAnn
                            .children()
                            .find(
                                (c: SgNode) =>
                                    c.kind() === 'type_identifier' ||
                                    c.kind() === 'identifier' ||
                                    c.kind() === 'generic_type',
                            );
                        if (typeNode) {
                            const typeName =
                                typeNode.kind() === 'generic_type'
                                    ? typeNode
                                          .children()
                                          .find((c: SgNode) => c.kind() === 'type_identifier')
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
    for (const node of rootNode.findAll({ rule: { kind: kinds.function } })) {
        const name = node.field('name')?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`f:${fp}:${name}:${line}`)) {
            continue;
        }
        if (
            node.ancestors().some((a: SgNode) => a.kind() === kinds.class || (isTS && a.kind() === kinds.abstractClass))
        ) {
            continue;
        }
        seen.add(`f:${fp}:${name}:${line}`);

        functions.push({
            name,
            line_start: line,
            line_end: node.range().end.line,
            params: node.field('parameters')?.text() || '()',
            returnType: node.field('return_type')?.text()?.replace(/^:\s*/, '') || '',
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
        rule: { kind: kinds.arrowContainer, has: { kind: kinds.arrowFunction } },
    })) {
        const name = node.field('name')?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`f:${fp}:${name}:${line}`)) {
            continue;
        }
        seen.add(`f:${fp}:${name}:${line}`);

        const arrow = node.children().find((c: SgNode) => c.kind() === kinds.arrowFunction);
        functions.push({
            name,
            line_start: line,
            line_end: node.range().end.line,
            params: arrow?.field('parameters')?.text() || '()',
            returnType: arrow?.field('return_type')?.text()?.replace(/^:\s*/, '') || '',
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
        for (const node of rootNode.findAll({ rule: { kind: kinds.interface } })) {
            const name = node.field('name')?.text();
            if (!name || seen.has(`i:${fp}:${name}`)) {
                continue;
            }
            seen.add(`i:${fp}:${name}`);

            const methods: string[] = [];
            const body = node.field('body');
            if (body) {
                for (const child of body.findAll({ rule: { kind: kinds.methodSignature } })) {
                    const mn = child.field('name')?.text();
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
        for (const node of rootNode.findAll({ rule: { kind: kinds.enum } })) {
            const name = node.field('name')?.text();
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
    for (const node of rootNode.findAll({ rule: { kind: kinds.import } })) {
        const sourceNode = node.children().find((c: SgNode) => c.kind() === 'string');
        const frag = sourceNode?.children().find((c: SgNode) => c.kind() === 'string_fragment');
        const modulePath = frag?.text() || sourceNode?.text()?.replace(/['"]/g, '') || '';
        if (!modulePath) {
            continue;
        }

        const names: string[] = [];
        const importClause = node.children().find((c: SgNode) => c.kind() === 'import_clause');
        if (importClause) {
            for (const child of importClause.children()) {
                if (child.kind() === 'identifier') {
                    names.push(child.text());
                } else if (child.kind() === 'named_imports') {
                    for (const spec of child.findAll({ rule: { kind: 'import_specifier' } })) {
                        const n =
                            spec.field('name')?.text() ||
                            spec
                                .children()
                                .find((c: SgNode) => c.kind() === 'identifier')
                                ?.text();
                        if (n) {
                            names.push(n);
                        }
                    }
                } else if (child.kind() === 'namespace_import') {
                    const alias = child.children().find((c: SgNode) => c.kind() === 'identifier');
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
    for (const node of rootNode.findAll({ rule: { kind: kinds.export } })) {
        const src = node.children().find((c: SgNode) => c.kind() === 'string');
        if (src) {
            const frag = src.children().find((c: SgNode) => c.kind() === 'string_fragment');
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

    return { classes, functions, imports, reExports, interfaces, enums, diEntries };
}

// ---------------------------------------------------------------------------
// TypeScript-specific call extraction config for shared extractCalls()
// ---------------------------------------------------------------------------

const TS_CALL_CONFIG: CallExtractionConfig = {
    selfPrefixes: ['this.'],
    superPrefixes: ['super.'],
    findEnclosingClass: (node) => {
        const kinds = LANG_KINDS.typescript;
        return (
            node.ancestors().find((a: SgNode) => a.kind() === kinds.class || a.kind() === kinds.abstractClass) ?? null
        );
    },
    getParentClass: (classNode) => {
        const heritage = classNode.children().find((c: SgNode) => c.kind() === 'class_heritage');
        const ext = heritage?.children().find((c: SgNode) => c.kind() === 'extends_clause');
        return ext
            ?.children()
            .find(
                (c: SgNode) =>
                    c.kind() === 'identifier' || c.kind() === 'type_identifier' || c.kind() === 'member_expression',
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
    const cons = newExpr.field('constructor');
    if (!cons) {
        return undefined;
    }
    const k = cons.kind();
    if (k === 'identifier' || k === 'type_identifier') {
        return cons.text();
    }
    // `new pkg.Foo()` — take the final member
    if (k === 'member_expression') {
        const prop = cons.field('property');
        return prop?.text();
    }
    return undefined;
}

/** Extract a type name from a `: Foo` type_annotation. */
function typeFromAnnotation(typeAnn: SgNode): string | undefined {
    const typeNode = typeAnn
        .children()
        .find(
            (c: SgNode) => c.kind() === 'type_identifier' || c.kind() === 'identifier' || c.kind() === 'generic_type',
        );
    if (!typeNode) {
        return undefined;
    }
    if (typeNode.kind() === 'generic_type') {
        return (
            typeNode
                .children()
                .find((c: SgNode) => c.kind() === 'type_identifier')
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
    for (const vd of scopeNode.findAll({ rule: { kind: 'variable_declarator' } })) {
        const nameNode = vd.children().find((c: SgNode) => c.kind() === 'identifier');
        const name = nameNode?.text();
        if (!name) {
            continue;
        }
        const typeAnn = vd.children().find((c: SgNode) => c.kind() === 'type_annotation');
        const newExpr = vd.children().find((c: SgNode) => c.kind() === 'new_expression');
        let typeName: string | undefined;
        if (typeAnn) {
            typeName = typeFromAnnotation(typeAnn);
        }
        if (!typeName && newExpr) {
            typeName = typeFromNewExpression(newExpr);
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
        fnNode.field('parameters') ?? fnNode.children().find((c: SgNode) => c.kind() === 'formal_parameters');
    if (!params) {
        return;
    }
    for (const p of params.children()) {
        const kind = p.kind();
        if (kind !== 'required_parameter' && kind !== 'optional_parameter') {
            continue;
        }
        const pattern = p.field('pattern') ?? p.children().find((c: SgNode) => c.kind() === 'identifier');
        const name = pattern?.kind() === 'identifier' ? pattern.text() : undefined;
        if (!name) {
            continue;
        }
        const typeAnn = p.children().find((c: SgNode) => c.kind() === 'type_annotation');
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
    const functionKinds = ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'];
    const functionRanges: { node: SgNode; bindings: Map<string, string> }[] = [];
    for (const kind of functionKinds) {
        for (const fn of rootNode.findAll({ rule: { kind } })) {
            functionRanges.push({ node: fn, bindings: collectBindings(fn, true) });
        }
    }
    // For each member_expression used as a call receiver, find the innermost
    // enclosing function whose binding matches `x`. Fall back to file scope.
    for (const ce of rootNode.findAll({ rule: { kind: 'call_expression' } })) {
        const fnField = ce.field('function');
        if (!fnField || fnField.kind() !== 'member_expression') {
            continue;
        }
        const objectNode = fnField.field('object');
        if (!objectNode || objectNode.kind() !== 'identifier') {
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
        if (!typeName) {
            continue;
        }
        // Column convention: end-of-function (≈ col of `(` of args). Matches
        // the call extractor so chained calls don't collide on receiver-type
        // lookup. See src/shared/extract-calls.ts.
        const r = (ce.field('function') ?? ce).range().end;
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
