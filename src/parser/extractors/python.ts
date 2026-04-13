import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { LANG_KINDS } from '../languages';
import { registerExtractor } from './engine';
import type { ExtractionResult, LanguageExtractors } from './spec';

export function extractPython(root: SgRoot, fp: string, seen: Set<string>, graph: RawGraph): void {
    const kinds = LANG_KINDS.python;
    const rootNode = root.root();

    // ── Classes ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.class } })) {
        const name = node.field('name')?.text();
        if (!name || seen.has(`c:${fp}:${name}`)) {
            continue;
        }
        seen.add(`c:${fp}:${name}`);

        const argList = node.field('superclasses') || node.children().find((c: SgNode) => c.kind() === 'argument_list');
        const extendsName =
            argList
                ?.children()
                .find((c: SgNode) => c.kind() === 'identifier')
                ?.text() || '';

        graph.classes.push({
            name,
            file: fp,
            line_start: node.range().start.line,
            line_end: node.range().end.line,
            extends: extendsName,
            implements: [],
            ast_kind: String(node.kind()),
            qualified: `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
        });
    }

    // ── Functions / Methods ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.function } })) {
        const name = node.field('name')?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`m:${fp}:${name}:${line}`)) {
            continue;
        }
        seen.add(`m:${fp}:${name}:${line}`);

        const classAncestor = node.ancestors().find((a: SgNode) => a.kind() === kinds.class);
        const className = classAncestor?.field('name')?.text() || '';
        const retType =
            node
                .field('return_type')
                ?.text()
                ?.replace(/^->\s*/, '') || '';

        const isTest = name.startsWith('test_');
        if (isTest) {
            graph.tests.push({
                name,
                file: fp,
                line_start: line,
                line_end: node.range().end.line,
                ast_kind: String(node.kind()),
                qualified: `${fp}::test:${name}`,
                content_hash: computeContentHash(node.text()),
            });
        }

        graph.functions.push({
            name,
            file: fp,
            line_start: line,
            line_end: node.range().end.line,
            params: node.field('parameters')?.text() || '()',
            returnType: retType,
            kind: name === '__init__' ? 'Constructor' : className ? 'Method' : 'Function',
            ast_kind: String(node.kind()),
            className,
            qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
            content_hash: computeContentHash(node.text()),
        });
    }

    // ── Imports (from X import Y) ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.import } })) {
        const modNode = node
            .children()
            .find((c: SgNode) => c.kind() === 'dotted_name' || c.kind() === 'relative_import');
        const modulePath = modNode?.text() || '';
        if (!modulePath) {
            continue;
        }

        const names: string[] = [];
        for (const child of node.children()) {
            if (child.kind() === 'dotted_name' && child !== modNode) {
                names.push(child.text());
            }
            if (child.kind() === 'identifier' && child !== modNode) {
                names.push(child.text());
            }
        }
        graph.imports.push({
            module: modulePath,
            file: fp,
            line: node.range().start.line,
            names,
            lang: 'python',
        });
    }

    // ── Regular imports (import X) ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.importRegular } })) {
        const modNode = node.children().find((c: SgNode) => c.kind() === 'dotted_name');
        if (modNode) {
            graph.imports.push({
                module: modNode.text(),
                file: fp,
                line: node.range().start.line,
                names: [modNode.text()],
                lang: 'python',
            });
        }
    }
}

/** Python-specific call extraction config for shared extractCalls(). */
const PYTHON_CALL_CONFIG: CallExtractionConfig = {
    selfPrefixes: ['self.'],
    superPrefixes: ['super().'],
    findEnclosingClass: (node) => node.ancestors().find((a: SgNode) => a.kind() === 'class_definition') ?? null,
    getParentClass: (classNode) => {
        const argList =
            classNode.field('superclasses') || classNode.children().find((c: SgNode) => c.kind() === 'argument_list');
        return argList
            ?.children()
            .find((c: SgNode) => c.kind() === 'identifier')
            ?.text();
    },
};

/**
 * Extract raw call sites from a Python AST.
 * Detects self.X() and super().X() to preserve class resolution context.
 */
export function extractCallsFromPython(root: SgRoot, fp: string, calls: RawCallSite[]): void {
    extractCalls(root.root(), fp, PYTHON_CALL_CONFIG, calls);
}

// ---------------------------------------------------------------------------
// Adapter: wraps the existing push-to-graph functions into LanguageExtractors
// ---------------------------------------------------------------------------

const pythonAdapter: LanguageExtractors = {
    extract(rootNode: SgNode, fp: string): ExtractionResult {
        const tempGraph: RawGraph = {
            functions: [], classes: [], interfaces: [], enums: [],
            tests: [], imports: [], reExports: [], rawCalls: [],
            diMaps: new Map(),
        };
        const seen = new Set<string>();
        const fakeRoot = { root: () => rootNode } as SgRoot;

        extractPython(fakeRoot, fp, seen, tempGraph);

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
            functions: tempGraph.functions.map((f) => ({
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
                isTest: testKeys.has(`${f.name}:${f.line_start}`),
                is_exported: f.is_exported ?? false,
                is_async: f.is_async ?? false,
                decorators: f.decorators ?? [],
                throws: f.throws ?? [],
            })),
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
        extractCallsFromPython(fakeRoot, fp, calls);
    },
};

registerExtractor('python', pythonAdapter);
