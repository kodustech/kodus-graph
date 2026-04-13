import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerExtractor } from './engine';
import { computeContentHash, emptyResult, extractDecorators, extractModifiers, hasTestAnnotation, isAsync, isExported, nodeRange } from './shared';
import type { ExtractionResult, LanguageExtractors } from './spec';

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
// Test detection config
// ---------------------------------------------------------------------------

const ANNOTATION_KIND = 'attribute_item';
const ANNOTATION_NAMES = ['test'];

// ---------------------------------------------------------------------------
// Rust extractor
// ---------------------------------------------------------------------------

export const rustExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes / Structs (struct_item only, NOT impl_item) ──────────
        for (const node of root.findAll({ rule: { kind: 'struct_item' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: '',
                implements: [],
                ast_kind: String(node.kind()),
                modifiers: '',
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, { customCheck: (_n, nd) => nd.children().some(c => String(c.kind()) === 'visibility_modifier') }),
                decorators: extractDecorators(node, ['attribute_item']),
            });
        }

        // ── Rust: impl Trait for Struct -> implements relationship ───────
        for (const implNode of root.findAll({ rule: { kind: 'impl_item' } })) {
            const traitName = implNode.field('trait')?.text();
            const typeName = implNode.field('type')?.text();
            if (traitName && typeName) {
                const structClass = result.classes.find((c) => c.name === typeName);
                if (structClass && !structClass.implements.includes(traitName)) {
                    structClass.implements.push(traitName);
                }
            }
        }

        // ── Interfaces / Traits ─────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'trait_item' } })) {
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
                is_exported: isExported(name, node, { customCheck: (_n, nd) => nd.children().some(c => String(c.kind()) === 'visibility_modifier') }),
            });
        }

        // ── Enums ───────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'enum_item' } })) {
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
                is_exported: isExported(name, node, { customCheck: (_n, nd) => nd.children().some(c => String(c.kind()) === 'visibility_modifier') }),
            });
        }

        // ── Functions ───────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'function_item' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            let className = '';

            // Rust: extract className from enclosing impl block
            const implAncestor = node.ancestors().find((a: SgNode) => a.kind() === 'impl_item');
            if (implAncestor) {
                className = implAncestor.field('type')?.text() || '';
            }

            const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

            // Test detection
            const isTest = hasTestAnnotation(node, ANNOTATION_KIND, ANNOTATION_NAMES);

            const funcModifiers = extractModifiers(node);
            const range = nodeRange(node);

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
                is_exported: isExported(name, node, { customCheck: (_n, nd) => nd.children().some(c => String(c.kind()) === 'visibility_modifier') }),
                is_async: isAsync(node),
                decorators: extractDecorators(node, ['attribute_item']),
                throws: [],
            });
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'use_declaration' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'rust',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        const config: CallExtractionConfig = {
            selfPrefixes: ['self.'],
            superPrefixes: [],
            findEnclosingClass: (node) => node.ancestors().find((a) => a.kind() === 'impl_item') ?? null,
        };
        extractCalls(root, fp, config, calls);
    },
};

registerExtractor('rust', rustExtractors);
