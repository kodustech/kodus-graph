import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { LANG_KINDS } from '../languages';

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
            implements: '',
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
