import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { LANG_KINDS } from '../../parser/languages';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor } from '../engine';
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
import { TS_NOISE } from './noise';

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
    noise: TS_NOISE,
};

function extractCallsTS(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
    // DI pattern: this.$FIELD.$METHOD($$$ARGS)
    for (const m of rootNode.findAll('this.$FIELD.$METHOD($$$ARGS)')) {
        const field = m.getMatch('FIELD')?.text();
        const method = m.getMatch('METHOD')?.text();
        if (!method || TS_NOISE.has(method)) {
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
// Backward-compat export used by tests/parser/call-extraction.test.ts
// ---------------------------------------------------------------------------

/**
 * Extract raw call sites from a TypeScript/JavaScript AST.
 * Finds DI calls (this.field.method) and direct calls ($CALLEE($$$ARGS)).
 * Filters NOISE. Does NOT resolve — just collects raw sites.
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
    };
}

const tsExtractors = createTsExtractors(true);
const jsExtractors = createTsExtractors(false);

// Register with the exact strings that getLanguageName / Lang enum produce.
// Lang.TypeScript === "TypeScript", Lang.Tsx === "Tsx", Lang.JavaScript === "JavaScript"
registerExtractor('TypeScript', tsExtractors);
registerExtractor('Tsx', tsExtractors);
registerExtractor('JavaScript', jsExtractors);

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
