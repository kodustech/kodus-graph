/**
 * Schema version written into ParseMetadata. Bump when GraphNode, GraphEdge,
 * or ParseMetadata shape changes in a way consumers must handle explicitly.
 *
 * Format: "major.minor" — bump major on breaking changes, minor on additive.
 *
 * 2.1 — Adds the `USES_TYPE` edge kind: a function's signature naming a type
 *       this repo declares. Additive — consumers that switch on `EdgeKind`
 *       should ignore unknown kinds rather than reject the graph. Graphs parsed
 *       before 2.1 simply lack these edges, so type-only dependencies stay
 *       invisible to their blast radius until re-parsed.
 *
 * 2.0 — `GraphNode.language` values normalized to canonical registry keys
 *       (`'TypeScript'` / `'Tsx'` / `'JavaScript'`; others lowercase). Pre-2.0
 *       emitted lowercase `'typescript'` / `'javascript'`, which mismatched
 *       the keys used by `registerExtractor` / `getCapabilitiesFor` / the
 *       noise registry. Interface shape unchanged; persisted graphs keyed on
 *       old values must be re-parsed to consult capabilities by language.
 */
export const SCHEMA_VERSION = '2.1';

/**
 * Default BFS depth for blast-radius traversal.
 *
 * Single source of truth. This used to be spelled three times — `2` as
 * `computeBlastRadius`'s signature default, `'3'` on `context --max-depth`, `'2'`
 * on `outline --max-depth` — and `analyze` passed `undefined` for the parameter,
 * silently taking the signature's 2. So `analyze` and `context` reported
 * different blast radii for the same diff, each internally consistent and
 * neither obviously wrong.
 *
 * 3 is what the review path (`context`) already used, so this keeps the primary
 * consumer's behaviour and brings the rest into line.
 */
export const DEFAULT_BLAST_MAX_DEPTH = 3;
