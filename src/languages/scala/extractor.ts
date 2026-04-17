import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeCyclomatic } from '../complexity';
import { registerExtractor } from '../engine';
import { computeContentHash, emptyResult, extractModifiers, isTestByNaming, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for Scala cyclomatic complexity.
// `case_clause` is reused for BOTH match-arms AND catch-arms (Scala catch
// syntax uses pattern matching: `catch { case e: T => ... }`). Including
// both `case_clause` and `catch_clause` would double-count every catch arm.
// Pick `case_clause` alone — it naturally covers match cases and catch cases.
// `if_expression` alone covers `else if` (nested if in alternative).
const SCALA_BRANCH_KINDS = [
    'if_expression',
    'for_expression',
    'while_expression',
    'do_while_expression',
    'case_clause',
] as const;

// ---------------------------------------------------------------------------
// Scala naming helpers
// ---------------------------------------------------------------------------

/**
 * Get the name from an `identifier` child node.
 */
function scalaTypeName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'identifier')
        ?.text();
}

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

/**
 * Extract the superclass from an `extends_clause` child.
 * Scala: `class Foo extends Bar with Trait1 with Trait2`
 * The first type_identifier in extends_clause is the superclass.
 */
function scalaExtends(node: SgNode): string | undefined {
    const extendsClause = node.children().find((c) => c.kind() === 'extends_clause');
    if (!extendsClause) {
        return undefined;
    }
    // The first type_identifier in the extends_clause is the parent class/trait
    const typeId = extendsClause.children().find((c) => c.kind() === 'type_identifier');
    return typeId?.text();
}

/**
 * Extract implemented traits from `extends_clause`.
 * After the first type_identifier, every type_identifier following a `with` keyword
 * is a mixed-in trait.
 */
function scalaImplements(node: SgNode): string[] {
    const extendsClause = node.children().find((c) => c.kind() === 'extends_clause');
    if (!extendsClause) {
        return [];
    }

    const traits: string[] = [];
    let afterWith = false;
    for (const child of extendsClause.children()) {
        if (child.kind() === 'with') {
            afterWith = true;
            continue;
        }
        if (afterWith && child.kind() === 'type_identifier') {
            traits.push(child.text());
            afterWith = false;
        }
    }
    return traits;
}

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the full import path from an import_declaration node.
 * Scala imports: `import com.example.models.User` or `import com.example.services._`
 * The path is built from consecutive `identifier` children joined by `.`.
 */
function extractImportModule(node: SgNode): string {
    const parts: string[] = [];
    for (const child of node.children()) {
        const k = child.kind();
        if (k === 'identifier') {
            parts.push(child.text());
        } else if (k === 'namespace_wildcard') {
            parts.push('_');
        }
    }

    if (parts.length > 0) {
        return parts.join('.');
    }

    // Fallback: strip import keyword
    return node
        .text()
        .replace(/^\s*import\s+/i, '')
        .replace(/[;{}]/g, '')
        .trim();
}

// ---------------------------------------------------------------------------
// Export detection
// ---------------------------------------------------------------------------

/**
 * In Scala, everything is public by default unless marked `private` or `protected`.
 */
function scalaIsExported(node: SgNode): boolean {
    const mods = extractModifiers(node);
    return !mods.includes('private') && !mods.includes('protected');
}

// ---------------------------------------------------------------------------
// Annotation extraction
// ---------------------------------------------------------------------------

/**
 * Extract annotations from a Scala node.
 * Annotations are direct `annotation` children of the node (class_definition,
 * function_definition, etc.).
 */
function scalaDecorators(node: SgNode): string[] {
    const decorators: string[] = [];

    for (const child of node.children()) {
        if (child.kind() === 'annotation') {
            decorators.push(child.text());
        }
    }

    return [...new Set(decorators)];
}

/**
 * Extract throws from `@throws` annotations.
 * In Scala, `@throws[ExceptionType]` declares checked exceptions.
 */
function scalaThrows(node: SgNode): string[] {
    const throws: string[] = [];

    for (const child of node.children()) {
        if (child.kind() === 'annotation') {
            const text = child.text();
            const match = text.match(/@throws\[([^\]]+)\]/);
            if (match) {
                throws.push(match[1]);
            }
        }
    }

    return throws;
}

// ---------------------------------------------------------------------------
// Parameter and return type helpers
// ---------------------------------------------------------------------------

function scalaParams(node: SgNode): string {
    const params = node.children().find((c) => c.kind() === 'parameters');
    return params ? params.text() : '()';
}

function scalaReturnType(node: SgNode): string {
    // Look for type_identifier or generic_type after ':'
    const children = node.children();
    let afterColon = false;
    for (const child of children) {
        if (child.kind() === ':') {
            afterColon = true;
            continue;
        }
        if (afterColon) {
            const k = child.kind();
            if (k === 'type_identifier' || k === 'generic_type') {
                return child.text();
            }
        }
    }
    return '';
}

// ---------------------------------------------------------------------------
// Trait method extraction
// ---------------------------------------------------------------------------

/**
 * Extract method names from a trait body.
 * In Scala, traits can have abstract methods (function_declaration)
 * and concrete methods (function_definition).
 */
function scalaTraitMethods(node: SgNode): string[] {
    const body = node.children().find((c) => c.kind() === 'template_body');
    if (!body) {
        return [];
    }

    const methods: string[] = [];
    for (const child of body.children()) {
        if (child.kind() === 'function_declaration' || child.kind() === 'function_definition') {
            const name = child.children().find((c) => c.kind() === 'identifier');
            if (name) {
                methods.push(name.text());
            }
        }
    }
    return methods;
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const FILE_PATTERNS = [/Test\.scala$/, /Spec\.scala$/, /Suite\.scala$/, /test/i];
const FUNC_PATTERNS = [/^test/i];

// ---------------------------------------------------------------------------
// Scala extractor
// ---------------------------------------------------------------------------

export const scalaExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes (class_definition) ──────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'class_definition' } })) {
            const name = scalaTypeName(node);
            if (!name) {
                continue;
            }

            const extendsVal = scalaExtends(node) || '';
            const implementsVal = scalaImplements(node);
            const classModifiers = extractModifiers(node);
            const range = nodeRange(node);

            // Check if it's a case class
            const isCaseClass = node.children().some((c) => c.kind() === 'case');
            const modStr = isCaseClass ? (classModifiers ? `case ${classModifiers}` : 'case') : classModifiers;

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsVal,
                implements: implementsVal,
                ast_kind: String(node.kind()),
                modifiers: modStr,
                content_hash: computeContentHash(node.text()),
                is_exported: scalaIsExported(node),
                decorators: scalaDecorators(node),
            });
        }

        // ── Objects (object_definition) ─────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'object_definition' } })) {
            const name = scalaTypeName(node);
            if (!name) {
                continue;
            }

            const extendsVal = scalaExtends(node) || '';
            const implementsVal = scalaImplements(node);
            const classModifiers = extractModifiers(node);
            const range = nodeRange(node);

            // Check if it's a case object
            const isCaseObject = node.children().some((c) => c.kind() === 'case');
            const modStr = isCaseObject ? (classModifiers ? `case ${classModifiers}` : 'case') : classModifiers;

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsVal,
                implements: implementsVal,
                ast_kind: String(node.kind()),
                modifiers: modStr,
                content_hash: computeContentHash(node.text()),
                is_exported: scalaIsExported(node),
                decorators: scalaDecorators(node),
            });
        }

        // ── Traits (trait_definition) → interfaces ──────────────────────
        for (const node of root.findAll({ rule: { kind: 'trait_definition' } })) {
            const name = scalaTypeName(node);
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.interfaces.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                methods: scalaTraitMethods(node),
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: scalaIsExported(node),
            });
        }

        // ── Functions with body (function_definition) ───────────────────
        for (const node of root.findAll({ rule: { kind: 'function_definition' } })) {
            const name = scalaTypeName(node);
            if (!name) {
                continue;
            }

            let className = '';
            const classAncestor = node.ancestors().find((a: SgNode) => {
                const k = String(a.kind());
                return k === 'class_definition' || k === 'object_definition' || k === 'trait_definition';
            });
            if (classAncestor) {
                className = scalaTypeName(classAncestor) || '';
            }

            const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

            // Test detection
            const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or');

            const funcModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                params: scalaParams(node),
                returnType: scalaReturnType(node),
                kind,
                ast_kind: String(node.kind()),
                className,
                modifiers: funcModifiers,
                content_hash: computeContentHash(node.text()),
                isTest,
                is_exported: scalaIsExported(node),
                is_async: false, // Scala has no async keyword; uses Futures
                decorators: scalaDecorators(node),
                throws: scalaThrows(node),
                complexity: computeCyclomatic(node, SCALA_BRANCH_KINDS),
            });
        }

        // ── Abstract functions (function_declaration — no body) ─────────
        for (const node of root.findAll({ rule: { kind: 'function_declaration' } })) {
            const name = scalaTypeName(node);
            if (!name) {
                continue;
            }

            let className = '';
            const classAncestor = node.ancestors().find((a: SgNode) => {
                const k = String(a.kind());
                return k === 'class_definition' || k === 'object_definition' || k === 'trait_definition';
            });
            if (classAncestor) {
                className = scalaTypeName(classAncestor) || '';
            }

            const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

            const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or');

            const funcModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                params: scalaParams(node),
                returnType: scalaReturnType(node),
                kind,
                ast_kind: String(node.kind()),
                className,
                modifiers: funcModifiers,
                content_hash: computeContentHash(node.text()),
                isTest,
                is_exported: scalaIsExported(node),
                is_async: false,
                decorators: scalaDecorators(node),
                throws: scalaThrows(node),
                complexity: computeCyclomatic(node, SCALA_BRANCH_KINDS),
            });
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
                names: [module],
                lang: 'scala',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        const findEnclosingClass = (node: SgNode): SgNode | null => {
            return (
                node.ancestors().find((a) => {
                    const k = String(a.kind());
                    return k === 'class_definition' || k === 'object_definition' || k === 'trait_definition';
                }) ?? null
            );
        };

        const config: CallExtractionConfig = {
            selfPrefixes: ['this.'],
            superPrefixes: ['super.'],
            findEnclosingClass,
            getParentClass: (classNode) => {
                return scalaExtends(classNode);
            },
        };
        extractCalls(root, fp, config, calls);
    },
};

registerExtractor('scala', scalaExtractors);
