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
