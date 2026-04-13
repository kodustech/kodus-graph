import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { NOISE } from '../../shared/filters';
import { log } from '../../shared/logger';
import { LANG_KINDS } from '../languages';
import { registerExtractor } from './engine';
import type { ExtractionResult, LanguageExtractors } from './spec';

export function extractRuby(root: SgRoot, fp: string, seen: Set<string>, graph: RawGraph): void {
    const kinds = LANG_KINDS.ruby;
    const rootNode = root.root();

    // ── Classes ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.class } })) {
        const name = node.field('name')?.text();
        if (!name || seen.has(`c:${fp}:${name}`)) {
            continue;
        }
        seen.add(`c:${fp}:${name}`);

        const superclass = node.field('superclass')?.text() || '';
        graph.classes.push({
            name,
            file: fp,
            line_start: node.range().start.line,
            line_end: node.range().end.line,
            extends: superclass,
            implements: [],
            ast_kind: String(node.kind()),
            qualified: `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
        });
    }

    // ── Modules ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.module } })) {
        const name = node.field('name')?.text();
        if (!name || seen.has(`c:${fp}:${name}`)) {
            continue;
        }
        seen.add(`c:${fp}:${name}`);
        graph.classes.push({
            name,
            file: fp,
            line_start: node.range().start.line,
            line_end: node.range().end.line,
            extends: '',
            implements: [],
            ast_kind: String(node.kind()),
            qualified: `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
        });
    }

    // ── Methods (regular + singleton) ──
    for (const methodKind of [kinds.method, kinds.singletonMethod]) {
        for (const node of rootNode.findAll({ rule: { kind: methodKind } })) {
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
                .find((a: SgNode) => a.kind() === kinds.class || a.kind() === kinds.module);
            const className = classAncestor?.field('name')?.text() || '';

            graph.functions.push({
                name,
                file: fp,
                line_start: line,
                line_end: node.range().end.line,
                params: node.field('parameters')?.text() || '()',
                returnType: '',
                kind: className ? 'Method' : 'Function',
                ast_kind: String(node.kind()),
                className,
                qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
                content_hash: computeContentHash(node.text()),
            });
        }
    }

    // ── Tests (RSpec: describe/it/context) ──
    for (const p of [
        "describe '$NAME' do $$$BODY end",
        'describe "$NAME" do $$$BODY end',
        "it '$NAME' do $$$BODY end",
        'it "$NAME" do $$$BODY end',
        "context '$NAME' do $$$BODY end",
        'context "$NAME" do $$$BODY end',
    ]) {
        try {
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
        } catch (err) {
            log.debug('Ruby pattern mismatch', { file: fp, pattern: p, error: String(err) });
        }
    }

    // ── Imports (require/require_relative) ──
    for (const p of [
        "require '$MODULE'",
        'require "$MODULE"',
        "require_relative '$MODULE'",
        'require_relative "$MODULE"',
    ]) {
        try {
            for (const m of rootNode.findAll(p)) {
                const mod = m.getMatch('MODULE')?.text();
                if (mod) {
                    graph.imports.push({
                        module: mod,
                        file: fp,
                        line: m.range().start.line,
                        names: [],
                        lang: 'ruby',
                    });
                }
            }
        } catch (err) {
            log.debug('Ruby pattern mismatch', { file: fp, pattern: p, error: String(err) });
        }
    }
}

/** Ruby-specific call extraction config for shared extractCalls(). */
function createRubyCallConfig(): CallExtractionConfig {
    const kinds = LANG_KINDS.ruby;
    return {
        selfPrefixes: ['self.'],
        superPrefixes: ['super'],
        findEnclosingClass: (node) =>
            node.ancestors().find((a: SgNode) => a.kind() === kinds.class || a.kind() === kinds.module) ?? null,
        getParentClass: (classNode) => classNode.field('superclass')?.text(),
    };
}

/**
 * Extract raw call sites from a Ruby AST.
 * Detects self.X() and super() to preserve class resolution context.
 */
export function extractCallsFromRuby(root: SgRoot, fp: string, calls: RawCallSite[]): void {
    const rootNode = root.root();
    const config = createRubyCallConfig();

    // Track lines already captured by the pattern-based extraction to avoid duplicates
    const seenLines = new Set<string>();

    extractCalls(rootNode, fp, config, calls);
    for (const c of calls) {
        seenLines.add(`${c.callName}:${c.line}`);
    }

    // ── call nodes: covers both paren and no-paren calls with arguments ──
    // The pattern $CALLEE($$$ARGS) only matches calls with literal parentheses.
    // This loop catches the remaining call nodes (no-paren style).
    for (const node of rootNode.findAll({ rule: { kind: 'call' } })) {
        const methodNode = node.field('method');
        const callName = methodNode?.text();
        if (!callName || NOISE.has(callName)) {
            continue;
        }
        const line = node.range().start.line;
        if (seenLines.has(`${callName}:${line}`)) {
            continue;
        }
        seenLines.add(`${callName}:${line}`);

        let resolveInClass: string | undefined;
        const receiver = node.field('receiver');
        if (receiver?.text() === 'self') {
            const classNode = config.findEnclosingClass(node);
            resolveInClass = classNode?.field('name')?.text();
        }

        calls.push({
            source: fp,
            callName,
            line,
            ...(resolveInClass ? { resolveInClass } : {}),
        });
    }

    // ── bare identifiers in body_statement: no-arg, no-paren calls (e.g., `authenticate_user`) ──
    for (const node of rootNode.findAll({ rule: { kind: 'identifier' } })) {
        const parent = node.parent();
        if (!parent || parent.kind() !== 'body_statement') {
            continue;
        }
        const callName = node.text();
        if (NOISE.has(callName)) {
            continue;
        }
        const line = node.range().start.line;
        if (seenLines.has(`${callName}:${line}`)) {
            continue;
        }
        seenLines.add(`${callName}:${line}`);

        calls.push({
            source: fp,
            callName,
            line,
        });
    }
}

// ---------------------------------------------------------------------------
// Adapter: wraps the existing push-to-graph functions into LanguageExtractors
// ---------------------------------------------------------------------------

const rubyAdapter: LanguageExtractors = {
    extract(rootNode: SgNode, fp: string): ExtractionResult {
        const tempGraph: RawGraph = {
            functions: [], classes: [], interfaces: [], enums: [],
            tests: [], imports: [], reExports: [], rawCalls: [],
            diMaps: new Map(),
        };
        const seen = new Set<string>();
        const fakeRoot = { root: () => rootNode } as SgRoot;

        extractRuby(fakeRoot, fp, seen, tempGraph);

        // Track which (name, line) pairs are tests so we can mark them
        const testKeys = new Set(tempGraph.tests.map((t) => `${t.name}:${t.line_start}`));

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
                is_exported: c.is_exported ?? false,
                decorators: c.decorators ?? [],
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
                    is_exported: f.is_exported ?? false,
                    is_async: f.is_async ?? false,
                    decorators: f.decorators ?? [],
                    throws: f.throws ?? [],
                })),
                // Test blocks (describe/it/context) — not real functions, but
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
                        is_exported: false,
                        is_async: false,
                        decorators: [] as string[],
                        throws: [] as string[],
                    })),
            ],
            imports: tempGraph.imports.map((i) => ({
                module: i.module,
                line: i.line,
                names: i.names,
                lang: i.lang,
            })),
            reExports: [],
            interfaces: [],
            enums: [],
            diEntries: [],
        };
    },
    extractCalls(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
        const fakeRoot = { root: () => rootNode } as SgRoot;
        extractCallsFromRuby(fakeRoot, fp, calls);
    },
};

registerExtractor('ruby', rubyAdapter);
