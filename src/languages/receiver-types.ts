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
