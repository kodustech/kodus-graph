import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerExtractor } from './engine';
import { computeContentHash, emptyResult, hasTestAnnotation, isExported, isTestByNaming, nodeRange } from './shared';
import type { ExtractionResult, LanguageExtractors } from './spec';

// ---------------------------------------------------------------------------
// Go disambiguation helpers
// ---------------------------------------------------------------------------

/** Determine whether a Go `type_declaration` node is a struct, interface, or unknown. */
function goTypeKind(node: SgNode): 'struct' | 'interface' | null {
    const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
    if (!typeSpec) {
        return null;
    }
    const hasStruct = typeSpec.children().some((c) => c.kind() === 'struct_type');
    if (hasStruct) {
        return 'struct';
    }
    const hasInterface = typeSpec.children().some((c) => c.kind() === 'interface_type');
    if (hasInterface) {
        return 'interface';
    }
    return null;
}

/** Get the name for a Go `type_declaration` node (name lives inside `type_spec`). */
function goTypeName(node: SgNode): string | undefined {
    const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
    return typeSpec?.field('name')?.text();
}

// ---------------------------------------------------------------------------
// Import extraction helpers (shared logic extracted from generic.ts)
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    // Strategy 1: look for string literal children
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

    // Strategy 2: scoped identifiers / qualified names
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'scoped_identifier' || ck === 'scoped_type_identifier' || ck === 'qualified_name') {
            return child.text();
        }
    }

    // Strategy 3: namespace names / use_tree (Rust `use` paths)
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'name' || ck === 'namespace_name' || ck === 'use_tree') {
            return child.text();
        }
    }

    // Strategy 4: identifier children as last resort
    for (const child of node.children()) {
        if (child.kind() === 'identifier' || child.kind() === 'type_identifier') {
            return child.text();
        }
    }

    // Fallback: strip import/use/using/require prefix from full text
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

const FILE_PATTERNS = [/_test\.go$/];
const FUNC_PATTERNS = [/^Test/, /^Benchmark/];
const MATCH_MODE = 'and' as const;

// ---------------------------------------------------------------------------
// Go extractor
// ---------------------------------------------------------------------------

export const goExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes / Structs ────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'type_declaration' } })) {
            const kind = goTypeKind(node);
            if (kind !== 'struct') {
                continue;
            }
            const name = goTypeName(node);
            if (!name) {
                continue;
            }

            // Go struct embedding: field_declaration with type but no name
            let goExtends = '';
            const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
            const structType = typeSpec?.children().find((c) => c.kind() === 'struct_type');
            if (structType) {
                const fieldDeclList = structType.children().find((c) => c.kind() === 'field_declaration_list');
                if (fieldDeclList) {
                    for (const field of fieldDeclList.children()) {
                        if (field.kind() !== 'field_declaration') continue;
                        const fieldName = field.field('name');
                        const fieldType = field.field('type');
                        if (!fieldName && fieldType) {
                            const typeId = field.children().find((c) => c.kind() === 'type_identifier');
                            if (typeId) {
                                goExtends = typeId.text();
                                break;
                            }
                        }
                    }
                }
            }

            const range = nodeRange(node);
            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: goExtends,
                implements: [],
                ast_kind: String(node.kind()),
                modifiers: '',
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, { customCheck: (n) => /^[A-Z]/.test(n) }),
                decorators: [],
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'type_declaration' } })) {
            const kind = goTypeKind(node);
            if (kind !== 'interface') {
                continue;
            }
            const name = goTypeName(node);
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
                is_exported: isExported(name, node, { customCheck: (n) => /^[A-Z]/.test(n) }),
            });
        }

        // ── Functions / Methods ─────────────────────────────────────────
        const funcKinds = ['function_declaration', 'method_declaration'];

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) {
                    continue;
                }

                let className = '';

                // Go methods: extract className from receiver parameter
                if (node.kind() === 'method_declaration') {
                    const receiver = node.field('receiver');
                    if (receiver) {
                        for (const child of receiver.children()) {
                            if (child.kind() === 'parameter_declaration') {
                                for (const gc of child.children()) {
                                    if (gc.kind() === 'type_identifier') {
                                        className = gc.text();
                                        break;
                                    }
                                    if (gc.kind() === 'pointer_type') {
                                        for (const pt of gc.children()) {
                                            if (pt.kind() === 'type_identifier') {
                                                className = pt.text();
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (className) break;
                            }
                        }
                    }
                }

                const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

                // Test detection
                const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, MATCH_MODE);

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
                    modifiers: '',
                    content_hash: computeContentHash(node.text()),
                    isTest,
                    is_exported: isExported(name, node, { customCheck: (n) => /^[A-Z]/.test(n) }),
                    is_async: false,
                    decorators: [],
                    throws: [],
                });
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'import_declaration' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'go',
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
            selfPrefixes: [],
            superPrefixes: [],
            findEnclosingClass,
        };
        extractCalls(root, fp, config, calls);
    },
};

registerExtractor('go', goExtractors);
