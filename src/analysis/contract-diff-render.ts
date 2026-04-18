/**
 * Render params / return_type contract-diff entries with token-level diffs
 * for long signatures — reduces LLM token cost vs. dumping full before+after
 * blobs twice.
 *
 * Formatters (prompt-formatter.ts, xml-formatter.ts) call these helpers and
 * shape the result for their own output format.
 */

export const LONG_THRESHOLD_CHARS = 120;

/**
 * Split a parameter-list string by top-level commas, respecting nesting of
 * (), [], {}, <>. Strips the surrounding parens first if present.
 *
 * Example:
 *   '(a: Map<string, number>, b: string)' → ['a: Map<string, number>', 'b: string']
 */
export function tokenizeTopLevel(s: string): string[] {
    const inner = stripOuterParens(s.trim());
    if (!inner.trim()) {
        return [];
    }
    const tokens: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
            depth--;
        } else if (ch === ',' && depth === 0) {
            const tok = inner.slice(start, i).trim();
            if (tok) {
                tokens.push(tok);
            }
            start = i + 1;
        }
    }
    const tail = inner.slice(start).trim();
    if (tail) {
        tokens.push(tail);
    }
    return tokens;
}

function stripOuterParens(s: string): string {
    if (s.startsWith('(') && s.endsWith(')')) {
        return s.slice(1, -1);
    }
    return s;
}

function isLong(before: string, after: string): boolean {
    if (before.includes('\n') || after.includes('\n')) {
        return true;
    }
    return before.length + after.length > LONG_THRESHOLD_CHARS;
}

export interface ParamsDiffResult {
    mode: 'simple' | 'token';
    text: string;
    added: string[];
    removed: string[];
}

export function renderParamsDiff(before: string, after: string): ParamsDiffResult {
    if (!isLong(before, after)) {
        return {
            mode: 'simple',
            text: `${before} → ${after}`,
            added: [],
            removed: [],
        };
    }
    const beforeTokens = tokenizeTopLevel(before);
    const afterTokens = tokenizeTopLevel(after);
    const beforeSet = new Set(beforeTokens);
    const afterSet = new Set(afterTokens);
    const added = afterTokens.filter((t) => !beforeSet.has(t));
    const removed = beforeTokens.filter((t) => !afterSet.has(t));
    const lines: string[] = [];
    for (const r of removed) {
        lines.push(`- ${r}`);
    }
    for (const a of added) {
        lines.push(`+ ${a}`);
    }
    const text = lines.length > 0 ? lines.join('\n') : `${before} → ${after}`;
    return { mode: 'token', text, added, removed };
}

export interface ReturnTypeDiffResult {
    mode: 'simple' | 'long';
    text: string;
}

export function renderReturnTypeDiff(before: string, after: string): ReturnTypeDiffResult {
    if (!isLong(before, after)) {
        return { mode: 'simple', text: `${before} → ${after}` };
    }
    return { mode: 'long', text: `before: ${before}\nafter:  ${after}` };
}
