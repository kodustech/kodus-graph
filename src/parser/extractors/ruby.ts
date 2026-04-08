import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { log } from '../../shared/logger';
import { LANG_KINDS } from '../languages';

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
            implements: '',
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
            implements: '',
            qualified: `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
        });
    }

    // ── Methods ──
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
            className,
            qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
        });
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
    extractCalls(root.root(), fp, createRubyCallConfig(), calls);
}
