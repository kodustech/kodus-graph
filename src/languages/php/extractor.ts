import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor } from '../engine';
import { computeContentHash, emptyResult, extractModifiers, extractThrows, isTestByNaming, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { PHP_NOISE } from './noise';

// Branch kinds for PHP cyclomatic complexity.
// PHP grammar emits `else_if_clause` as a named child of `if_statement`
// (NOT as a nested if_statement), so both kinds are needed to count
// `elseif` branches. `case_statement` is the per-case kind (skip outer
// `switch_statement`).
const PHP_BRANCH_KINDS = [
    'if_statement',
    'else_if_clause',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'case_statement',
    'catch_clause',
    'conditional_expression',
] as const;

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function phpExtends(node: SgNode): string | undefined {
    const baseClause = node.children().find((c: SgNode) => c.kind() === 'base_clause');
    if (!baseClause) {
        return undefined;
    }
    // PHP base_clause child is `name` for simple names, `qualified_name` for namespaced ones
    const name = baseClause.children().find((c: SgNode) => c.kind() === 'name' || c.kind() === 'qualified_name');
    return name?.text();
}

function phpImplements(node: SgNode): string[] {
    const ifaceClause = node.children().find((c: SgNode) => c.kind() === 'class_interface_clause');
    if (!ifaceClause) {
        return [];
    }
    return ifaceClause
        .children()
        .filter((c: SgNode) => c.kind() === 'name' || c.kind() === 'qualified_name')
        .map((c: SgNode) => c.text());
}

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

const FUNC_PATTERNS = [/^test/];
const FILE_PATTERNS = [/Test\.php$/];

// ---------------------------------------------------------------------------
// PHP extractor
// ---------------------------------------------------------------------------

export const phpExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes ──────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            const extendsVal = phpExtends(node) || '';

            let implementsVal: string[] = [];
            const rawImpl = phpImplements(node);
            if (Array.isArray(rawImpl)) {
                implementsVal = rawImpl;
            }

            const classModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsVal,
                implements: implementsVal,
                ast_kind: String(node.kind()),
                modifiers: classModifiers,
                content_hash: computeContentHash(node.text()),
                is_exported: true, // PHP classes are public by default
                decorators: [],
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'interface_declaration' } })) {
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
                is_exported: true, // PHP interfaces are public by default
            });
        }

        // ── Functions / Methods ─────────────────────────────────────────
        const funcKinds = ['function_definition', 'method_declaration'];
        const methodKindSet = new Set(['method_declaration']);

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) {
                    continue;
                }

                let className = '';
                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                if (classAncestor) {
                    className = classAncestor.field('name')?.text() || '';
                }

                let kind: 'Function' | 'Method' | 'Constructor';
                if (methodKindSet.has(funcKind) || className) {
                    kind = 'Method';
                } else {
                    kind = 'Function';
                }

                // Test detection
                const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or');

                const funcModifiers = extractModifiers(node);
                const range = nodeRange(node);

                // PHP: public by default unless private/protected visibility_modifier
                const visibilityMod = node.children().find((c) => String(c.kind()) === 'visibility_modifier');
                const phpExported = !visibilityMod || visibilityMod.text() === 'public';

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
                    is_exported: phpExported,
                    is_async: false,
                    decorators: [],
                    throws: extractThrows(node, ['throw_expression']),
                    complexity: computeCyclomatic(node, PHP_BRANCH_KINDS),
                });
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'namespace_use_declaration' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'php',
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
            selfPrefixes: ['$this->'],
            superPrefixes: ['parent::'],
            findEnclosingClass,
            noise: PHP_NOISE,
        };
        extractCalls(root, fp, config, calls);
    },
};

registerExtractor('php', phpExtractors);

// DI heuristic: Symfony/Laravel projects mirror the Java/Spring convention.
function phpDiHeuristics(typeName: string): string[] {
    return [`${typeName}Impl`, `Default${typeName}`];
}

registerDIHeuristics('php', phpDiHeuristics);
