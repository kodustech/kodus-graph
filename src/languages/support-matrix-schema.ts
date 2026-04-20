import { z } from 'zod';

/**
 * Per-language support record. Single source of truth for what kodus-graph
 * claims to support for each registered language. Consumed by:
 *   - `scripts/generate-language-matrix.ts` → docs/language-support-matrix.md
 *   - `tests/integration/language-coverage.test.ts` → CI quality gate
 *
 * `tier` interpretation:
 *   - 'full':         validated on a real open-source repo ≥10k LOC, all features registered
 *   - 'basic':        unit-tested on fixtures, no real-repo validation, features partially registered
 *   - 'experimental': registered but not tested beyond smoke fixtures; expect gaps
 */
/**
 * `receiver_type` values describe how a language infers the receiver type of a
 * method/attribute call. Values map to currently-shipped implementations:
 *
 *   - 'none':        no receiver-type inference (dynamic langs without hints)
 *   - 'scope-local': JVM/.NET/Rust/Swift/Scala family — `Foo x = new Foo()` inside
 *                    a function body, receiver resolved from the local declaration
 *   - 'class+init':  Python — class attributes + `__init__` typed params + typed
 *                    params in methods, stored on `self` (one combined impl)
 *   - 'factory':     Go — `x := NewFoo()` factory-naming sniff
 *   - 'full':        reserved for future full flow/type analysis
 */
const featuresSchema = z
    .object({
        noise: z.boolean(),
        capabilities: z.boolean(),
        di_heuristic: z.boolean(),
        receiver_type: z.enum(['none', 'scope-local', 'class+init', 'factory', 'full']),
        complexity_kinds: z.boolean(),
        imports: z.boolean(),
    })
    .strict();

const baselineTierRatiosSchema = z
    .object({
        /** `(total_edges_resolved) / (total_call_sites)` must be ≥ this. */
        resolved_min: z.number().min(0).max(1),
        /** `ambiguous / resolved` must be ≤ this. */
        ambiguous_max: z.number().min(0).max(1),
        /**
         * `receiver / (nodes/1000)` must be ≥ this (receiver hits per 1k nodes).
         * Capped at 500 to catch percentage-as-rate typos — a single node can
         * only be a call site a bounded number of times.
         */
        receiver_min_per_1k_nodes: z.number().min(0).max(500),
        /** `di / (nodes/1000)` must be ≥ this. 0 means language opts out. Capped at 500 (see above). */
        di_min_per_1k_nodes: z.number().min(0).max(500),
        /** `(receiver + di + same) / resolved` must be ≥ this. */
        high_conf_min_ratio: z.number().min(0).max(1),
    })
    .strict();

export const recordSchema = z
    .object({
        key: z.string(),
        display_name: z.string(),
        tier: z.enum(['full', 'basic', 'experimental']),
        parse_speed: z.enum(['fast', 'moderate', 'slow']),
        features: featuresSchema,
        canonical_fixture: z.string().nullable(),
        baseline_tier_ratios: baselineTierRatiosSchema.nullable(),
        notes: z.array(z.string()),
    })
    .strict();

export const supportMatrixSchema = z.array(recordSchema);

export type LanguageSupportRecord = z.infer<typeof recordSchema>;
