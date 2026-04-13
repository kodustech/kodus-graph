import type { SgNode, SgRoot } from '@ast-grep/napi';
import { Lang } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { NOISE } from '../../shared/filters';
import { LANG_KINDS } from '../languages';
import { registerExtractor } from './engine';
import type { ExtractionResult, LanguageExtractors } from './spec';

export function extractTypeScript(
    root: SgRoot,
    fp: string,
    seen: Set<string>,
    graph: RawGraph,
    lang: Lang | string = Lang.TypeScript,
): void {
    const kinds = LANG_KINDS.typescript;
    const rootNode = root.root();
    const isTS = lang === Lang.TypeScript || lang === Lang.Tsx;

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

            graph.classes.push({
                name,
                file: fp,
                line_start: node.range().start.line,
                line_end: node.range().end.line,
                extends: extendsName,
                implements: implementsNames,
                ast_kind: String(node.kind()),
                qualified: `${fp}::${name}`,
                content_hash: computeContentHash(node.text()),
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
            const fieldTypeMap = new Map<string, string>();
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
                            fieldTypeMap.set(ident.text(), typeName);
                        }
                    }
                }
            }
            if (fieldTypeMap.size > 0) {
                graph.diMaps.set(fp, fieldTypeMap);
            }

            graph.functions.push({
                name: `${className}.constructor`,
                file: fp,
                line_start: line,
                line_end: node.range().end.line,
                params: params?.text() || '()',
                returnType: '',
                kind: 'Constructor',
                ast_kind: String(node.kind()),
                className,
                qualified: `${fp}::${className}.constructor`,
                content_hash: computeContentHash(node.text()),
            });
        } else {
            graph.functions.push({
                name,
                file: fp,
                line_start: line,
                line_end: node.range().end.line,
                params: params?.text() || '()',
                returnType: retType,
                kind: className ? 'Method' : 'Function',
                ast_kind: String(node.kind()),
                className,
                qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
                content_hash: computeContentHash(node.text()),
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

        graph.functions.push({
            name,
            file: fp,
            line_start: line,
            line_end: node.range().end.line,
            params: node.field('parameters')?.text() || '()',
            returnType: node.field('return_type')?.text()?.replace(/^:\s*/, '') || '',
            kind: 'Function',
            ast_kind: String(node.kind()),
            className: '',
            qualified: `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
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
        graph.functions.push({
            name,
            file: fp,
            line_start: line,
            line_end: node.range().end.line,
            params: arrow?.field('parameters')?.text() || '()',
            returnType: arrow?.field('return_type')?.text()?.replace(/^:\s*/, '') || '',
            kind: 'Function',
            ast_kind: 'arrow_function',
            className: '',
            qualified: `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
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

            graph.interfaces.push({
                name,
                file: fp,
                line_start: node.range().start.line,
                line_end: node.range().end.line,
                methods,
                ast_kind: String(node.kind()),
                qualified: `${fp}::${name}`,
                content_hash: computeContentHash(node.text()),
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
            graph.enums.push({
                name,
                file: fp,
                line_start: node.range().start.line,
                line_end: node.range().end.line,
                ast_kind: String(node.kind()),
                qualified: `${fp}::${name}`,
                content_hash: computeContentHash(node.text()),
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
        graph.imports.push({
            module: modulePath,
            file: fp,
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
            graph.reExports.push({
                module: frag?.text() || src.text().replace(/['"]/g, ''),
                file: fp,
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
            graph.tests.push({
                name,
                file: fp,
                line_start: m.range().start.line,
                line_end: m.range().end.line,
                ast_kind: String(m.kind()),
                qualified: `${fp}::test:${name}`,
                content_hash: computeContentHash(m.text()),
            });
        }
    }
}

/** TypeScript-specific call extraction config for shared extractCalls(). */
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
    // Skip this.field.method — already handled by the DI pattern above
    skipCallee: (callee) => callee.startsWith('this.') && callee.substring(5).includes('.'),
};

/**
 * Extract raw call sites from a TypeScript/JavaScript AST.
 * Finds DI calls (this.field.method) and direct calls ($CALLEE($$$ARGS)).
 * Filters NOISE. Does NOT resolve — just collects raw sites.
 */
export function extractCallsFromTypeScript(root: SgRoot, fp: string, calls: RawCallSite[]): void {
    const rootNode = root.root();

    // DI pattern: this.$FIELD.$METHOD($$$ARGS)
    for (const m of rootNode.findAll('this.$FIELD.$METHOD($$$ARGS)')) {
        const field = m.getMatch('FIELD')?.text();
        const method = m.getMatch('METHOD')?.text();
        if (!method || NOISE.has(method)) {
            continue;
        }
        calls.push({
            source: fp,
            callName: method,
            line: m.range().start.line,
            diField: field,
        });
    }

    // Direct calls + self/super detection via shared function
    extractCalls(rootNode, fp, TS_CALL_CONFIG, calls);
}

// ---------------------------------------------------------------------------
// Adapter: wraps the existing push-to-graph functions into LanguageExtractors
// ---------------------------------------------------------------------------

function createTsAdapter(lang: Lang): LanguageExtractors {
    return {
        extract(rootNode: SgNode, fp: string): ExtractionResult {
            const tempGraph: RawGraph = {
                functions: [], classes: [], interfaces: [], enums: [],
                tests: [], imports: [], reExports: [], rawCalls: [],
                diMaps: new Map(),
            };
            const seen = new Set<string>();
            const fakeRoot = { root: () => rootNode } as SgRoot;

            extractTypeScript(fakeRoot, fp, seen, tempGraph, lang);

            return {
                classes: tempGraph.classes.map((c) => ({
                    name: c.name,
                    line_start: c.line_start,
                    line_end: c.line_end,
                    extends: c.extends,
                    implements: c.implements,
                    modifiers: c.modifiers || '',
                    ast_kind: c.ast_kind,
                    content_hash: c.content_hash,
                })),
                functions: [
                    ...tempGraph.functions.map((f) => ({
                        name: f.name,
                        line_start: f.line_start,
                        line_end: f.line_end,
                        params: f.params,
                        returnType: f.returnType,
                        kind: f.kind,
                        className: f.className,
                        modifiers: f.modifiers || '',
                        ast_kind: f.ast_kind,
                        content_hash: f.content_hash,
                        isTest: false,
                    })),
                    // Test blocks (describe/it/test) — not real functions, but
                    // the engine only creates graph.tests from isTest functions.
                    ...tempGraph.tests
                        .filter((t) => !tempGraph.functions.some(
                            (f) => f.name === t.name && f.line_start === t.line_start,
                        ))
                        .map((t) => ({
                            name: t.name,
                            line_start: t.line_start,
                            line_end: t.line_end,
                            params: '',
                            returnType: '',
                            kind: 'Function' as const,
                            className: '',
                            modifiers: '',
                            ast_kind: t.ast_kind,
                            content_hash: t.content_hash,
                            isTest: true,
                        })),
                ],
                imports: tempGraph.imports.map((i) => ({
                    module: i.module,
                    line: i.line,
                    names: i.names,
                    lang: i.lang,
                })),
                reExports: tempGraph.reExports.map((r) => ({
                    module: r.module,
                    line: r.line,
                })),
                interfaces: tempGraph.interfaces.map((i) => ({
                    name: i.name,
                    line_start: i.line_start,
                    line_end: i.line_end,
                    methods: i.methods,
                    ast_kind: i.ast_kind,
                    content_hash: i.content_hash,
                })),
                enums: tempGraph.enums.map((e) => ({
                    name: e.name,
                    line_start: e.line_start,
                    line_end: e.line_end,
                    ast_kind: e.ast_kind,
                    content_hash: e.content_hash,
                })),
                diEntries: [...(tempGraph.diMaps.get(fp)?.entries() ?? [])].map(
                    ([k, v]) => ({ fieldName: k, typeName: v }),
                ),
            };
        },
        extractCalls(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
            const fakeRoot = { root: () => rootNode } as SgRoot;
            extractCallsFromTypeScript(fakeRoot, fp, calls);
        },
    };
}

const tsAdapter = createTsAdapter(Lang.TypeScript);
const tsxAdapter = createTsAdapter(Lang.TypeScript);  // TSX uses the same TS extraction
const jsAdapter = createTsAdapter(Lang.JavaScript);

// Register with the exact strings that getLanguageName / Lang enum produce.
// Lang.TypeScript === "TypeScript", Lang.Tsx === "Tsx", Lang.JavaScript === "JavaScript"
registerExtractor('TypeScript', tsAdapter);
registerExtractor('Tsx', tsxAdapter);
registerExtractor('JavaScript', jsAdapter);
