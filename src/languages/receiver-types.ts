/**
 * Scope-local receiver-type inference shared across language extractors.
 *
 * Maps a call-site location key to the inferred type of its receiver, e.g.
 * `x.update()` where `x` is declared as `const x = new Foo()` records
 * `{ locationKey: 'src/caller.ts:10:4' → 'Foo' }`. The resolver consults this
 * map before the DI / name-based cascade to pick `Foo.update` at high
 * confidence when only one such method exists globally.
 *
 * The implementation is intentionally conservative: only explicit types
 * (`const x: Foo = ...`) and `new` expressions (`const x = new Foo()`) are
 * tracked. Full type inference is out of scope — dynamic languages
 * (Ruby, PHP, Elixir) simply register a no-op that returns an empty map.
 */

export type ReceiverTypeMap = Map<string, string>;

/**
 * Build a location key used to index the receiver-type map.
 *
 * `column` is optional because ast-grep doesn't always surface it
 * consistently across grammars. When unavailable, pass `-1` and the
 * resolver will fall back to line-only matching (see parser/batch.ts).
 */
export function locationKey(file: string, line: number, column: number): string {
    return `${file}:${line}:${column}`;
}

/**
 * A lexical scope (function body, class body, …) paired with the var→type
 * bindings collected inside it, keyed by byte range for containment tests.
 */
export interface RangedScope {
    start: number;
    end: number;
    bindings: Map<string, string>;
}

/**
 * Precomputed index over a file's scopes, used to resolve a call's receiver
 * type to the binding from its innermost enclosing scope.
 *
 * Replaces the previous O(calls × scopes) per-call scan (which dominated
 * receiver-type time on large TS/Python files — concentrated in the top ~1%
 * of files) with two cheap wins that keep the result byte-identical:
 *   1. `boundNames` — the union of every binding key. A receiver not present
 *      here is bound in NO scope, so the scan is skipped entirely (O(1)).
 *   2. `sorted` — scopes ordered smallest-first, so the FIRST scope that both
 *      contains the call and binds the receiver IS the innermost match; we
 *      stop there instead of scanning all scopes tracking the minimum size.
 */
export interface ScopeIndex {
    boundNames: Set<string>;
    sorted: RangedScope[];
}

export function buildScopeIndex(scopes: RangedScope[]): ScopeIndex {
    const boundNames = new Set<string>();
    for (const s of scopes) {
        for (const k of s.bindings.keys()) {
            boundNames.add(k);
        }
    }
    // Smallest (innermost) scope first → first containing match is the minimum.
    const sorted = [...scopes].sort((a, b) => a.end - a.start - (b.end - b.start));
    return { boundNames, sorted };
}

/**
 * Resolve `receiver` to the type bound by the innermost scope that encloses
 * the call span `[callStart, callEnd]`. Returns undefined when no enclosing
 * scope binds the receiver — identical to the old min-size scan, just faster.
 */
export function resolveReceiverScope(
    index: ScopeIndex,
    callStart: number,
    callEnd: number,
    receiver: string,
): string | undefined {
    if (!index.boundNames.has(receiver)) {
        return undefined;
    }
    for (const s of index.sorted) {
        if (s.start <= callStart && s.end >= callEnd && s.bindings.has(receiver)) {
            return s.bindings.get(receiver);
        }
    }
    return undefined;
}
