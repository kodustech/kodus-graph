import type { SgNode } from '@ast-grep/napi';
import type { ExtractionResult } from './spec';

// Re-export from the canonical location so per-language extractors use a single import
export { computeContentHash } from '../../shared/file-hash';

/**
 * Extract the full modifiers string from a node.
 * Looks for a `modifiers` or `accessibility_modifier` child and returns its
 * text with whitespace normalised (e.g. "@Service @Autowired public static").
 */
export function extractModifiers(node: SgNode): string {
    for (const child of node.children()) {
        const kind = child.kind();
        if (kind === 'modifiers' || kind === 'accessibility_modifier') {
            return child.text().replace(/\s+/g, ' ').trim();
        }
    }
    return '';
}

/**
 * Walk up ancestors and return the first node whose `kind()` is in `kinds`.
 * Returns `null` when no ancestor matches.
 */
export function findAncestorByKinds(node: SgNode, kinds: string[]): SgNode | null {
    const kindSet = new Set(kinds);
    return node.ancestors().find((a: SgNode) => kindSet.has(a.kind())) ?? null;
}

/**
 * Get start/end line numbers for a node (0-based, same as ast-grep range).
 */
export function nodeRange(node: SgNode): { line_start: number; line_end: number } {
    return {
        line_start: node.range().start.line,
        line_end: node.range().end.line,
    };
}

/**
 * Detect whether a function is a test based on file-path and function-name
 * patterns.
 *
 * @param matchMode - 'and' means BOTH file and func patterns must match;
 *                    'or' (default) means EITHER is sufficient.
 */
export function isTestByNaming(
    fp: string,
    funcName: string,
    filePatterns: RegExp[],
    funcPatterns: RegExp[],
    matchMode: 'and' | 'or' = 'or',
): boolean {
    const fileMatch = filePatterns.length > 0 && filePatterns.some((re) => re.test(fp));
    const funcMatch = funcPatterns.length > 0 && funcPatterns.some((re) => re.test(funcName));

    if (matchMode === 'and') {
        const fileOk = filePatterns.length === 0 || fileMatch;
        const funcOk = funcPatterns.length === 0 || funcMatch;
        return fileOk && funcOk;
    }

    // 'or' — either matching is sufficient
    return fileMatch || funcMatch;
}

/**
 * Detect whether a function node has a test annotation (e.g. `@Test`, `#[test]`).
 * Checks both previous siblings and direct children (modifiers / attribute_list).
 */
export function hasTestAnnotation(node: SgNode, annotationKind: string, names: string[]): boolean {
    if (!annotationKind || names.length === 0) {
        return false;
    }

    function textMatchesAnnotation(text: string): boolean {
        return names.some((name) => text.includes(name));
    }

    // Check previous siblings for annotation nodes
    for (const sibling of node.prevAll()) {
        if (sibling.kind() === annotationKind && textMatchesAnnotation(sibling.text())) {
            return true;
        }
    }

    // Check inside modifiers or attribute_list children of the function node
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'modifiers' || ck === 'attribute_list' || ck === annotationKind) {
            if (textMatchesAnnotation(child.text())) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Return a fresh, empty `ExtractionResult` — handy as a starting point
 * inside `extract()` implementations.
 */
export function emptyResult(): ExtractionResult {
    return {
        classes: [],
        functions: [],
        imports: [],
        reExports: [],
        interfaces: [],
        enums: [],
        diEntries: [],
    };
}

// ---------------------------------------------------------------------------
// Shared extraction helpers for new graph fields
// ---------------------------------------------------------------------------

export interface ExportRules {
    /** Keywords that mark a declaration as exported (e.g., 'export', 'pub', 'public') */
    exportKeywords?: string[];
    /** Check modifiers node for these keywords */
    modifierKeywords?: string[];
    /** Custom check based on name/node (Go uppercase, Python no underscore) */
    customCheck?: (name: string, node: SgNode) => boolean;
}

/**
 * Check if a node is exported based on language-specific rules.
 */
export function isExported(name: string, node: SgNode, rules: ExportRules): boolean {
    if (rules.customCheck?.(name, node)) return true;

    // Check for export keyword as sibling or parent
    if (rules.exportKeywords?.length) {
        // Check parent node (export_statement wrapping the declaration)
        const parent = node.parent();
        if (parent && rules.exportKeywords.some(kw => String(parent.kind()).includes(kw))) return true;
        // Check previous siblings
        for (const sib of node.prevAll()) {
            if (rules.exportKeywords.some(kw => String(sib.kind()) === kw || sib.text() === kw)) return true;
        }
    }

    // Check modifiers child
    if (rules.modifierKeywords?.length) {
        const mods = node.children().find(c => String(c.kind()) === 'modifiers');
        if (mods) {
            const modText = mods.text();
            return rules.modifierKeywords.some(kw => modText.includes(kw));
        }
    }

    return false;
}

/**
 * Check if a function node has async keyword.
 */
export function isAsync(node: SgNode): boolean {
    // Check direct children for 'async' keyword
    for (const child of node.children()) {
        if (String(child.kind()) === 'async' || child.text() === 'async') return true;
    }
    return false;
}

/**
 * Extract decorator/annotation text from sibling or parent nodes.
 */
export function extractDecorators(node: SgNode, decoratorKinds: string[]): string[] {
    const decorators: string[] = [];
    if (!decoratorKinds.length) return decorators;

    // Check previous siblings (TS/Python decorators come before the declaration)
    for (const sib of node.prevAll()) {
        if (decoratorKinds.includes(String(sib.kind()))) {
            decorators.push(sib.text());
        }
    }

    // Check parent for decorated_definition (Python) or annotation containers
    const parent = node.parent();
    if (parent) {
        for (const child of parent.children()) {
            if (decoratorKinds.includes(String(child.kind())) && child !== node) {
                decorators.push(child.text());
            }
        }
    }

    // Check inside modifiers (Java/Kotlin annotations inside modifiers node)
    const mods = node.children().find(c => String(c.kind()) === 'modifiers');
    if (mods) {
        for (const child of mods.children()) {
            if (decoratorKinds.includes(String(child.kind()))) {
                decorators.push(child.text());
            }
        }
    }

    return [...new Set(decorators)]; // deduplicate
}

/**
 * Extract throw/raise types from a function body.
 */
export function extractThrows(node: SgNode, throwKinds: string[]): string[] {
    const throws: string[] = [];
    if (!throwKinds.length) return throws;

    const body = node.field('body') || node.children().find(c => {
        const k = String(c.kind());
        return k === 'statement_block' || k === 'block' ||
            k === 'function_body' || k === 'compound_statement';
    });
    if (!body) return throws;

    for (const kind of throwKinds) {
        const throwNodes = body.findAll({ rule: { kind } });
        for (const t of throwNodes) {
            // Extract the exception type/name
            const text = t.text().replace(/^(throw|raise)\s+/, '').replace(/[;(].*/, '').trim();
            if (text && text !== 'error' && !throws.includes(text)) {
                throws.push(text);
            }
        }
    }

    return throws;
}
