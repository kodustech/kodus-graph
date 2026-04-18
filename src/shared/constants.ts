/**
 * Schema version written into ParseMetadata. Bump when GraphNode, GraphEdge,
 * or ParseMetadata shape changes in a way consumers must handle explicitly.
 *
 * Format: "major.minor" — bump major on breaking changes, minor on additive.
 *
 * 2.0 — `GraphNode.language` values normalized to canonical registry keys
 *       (`'TypeScript'` / `'Tsx'` / `'JavaScript'`; others lowercase). Pre-2.0
 *       emitted lowercase `'typescript'` / `'javascript'`, which mismatched
 *       the keys used by `registerExtractor` / `getCapabilitiesFor` / the
 *       noise registry. Interface shape unchanged; persisted graphs keyed on
 *       old values must be re-parsed to consult capabilities by language.
 */
export const SCHEMA_VERSION = '2.0';
