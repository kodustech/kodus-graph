import { describe, expect, it } from 'bun:test';
import { listRegisteredLanguages } from '../src/languages/engine';
import { LANGUAGE_SUPPORT } from '../src/languages/support-matrix';
import { type LanguageSupportRecord, supportMatrixSchema } from '../src/languages/support-matrix-schema';
// Side-effect imports: make sure every language registers itself.
import '../src/languages/c';
import '../src/languages/csharp';
import '../src/languages/dart';
import '../src/languages/elixir';
import '../src/languages/go';
import '../src/languages/java';
import '../src/languages/kotlin';
import '../src/languages/php';
import '../src/languages/python';
import '../src/languages/ruby';
import '../src/languages/rust';
import '../src/languages/scala';
import '../src/languages/swift';
import '../src/languages/typescript';

describe('support-matrix-schema', () => {
    it('accepts a fully-populated record', () => {
        const record: LanguageSupportRecord = {
            key: 'TypeScript',
            display_name: 'TypeScript',
            tier: 'full',
            parse_speed: 'fast',
            features: {
                noise: true,
                capabilities: true,
                di_heuristic: true,
                receiver_type: 'class+init',
                complexity_kinds: true,
                imports: true,
            },
            canonical_fixture: 'tests/fixtures/sample-repo',
            baseline_tier_ratios: {
                resolved_min: 0.7,
                ambiguous_max: 0.45,
                receiver_min_per_1k_nodes: 20,
                di_min_per_1k_nodes: 10,
                high_conf_min_ratio: 0.1,
            },
            notes: [],
        };
        expect(() => supportMatrixSchema.parse([record])).not.toThrow();
    });

    it('rejects a record with unknown tier', () => {
        const bad = [
            {
                key: 'X',
                display_name: 'X',
                tier: 'godlike',
                parse_speed: 'fast',
                features: {
                    noise: true,
                    capabilities: true,
                    di_heuristic: false,
                    receiver_type: 'none',
                    complexity_kinds: true,
                    imports: false,
                },
                canonical_fixture: null,
                baseline_tier_ratios: null,
                notes: [],
            },
        ];
        expect(() => supportMatrixSchema.parse(bad)).toThrow();
    });

    it('rejects a record missing exactly one required nested field', () => {
        const bad = [
            {
                key: 'Y',
                display_name: 'Y',
                tier: 'full',
                parse_speed: 'fast',
                features: {
                    noise: true,
                    capabilities: true,
                    di_heuristic: false,
                    receiver_type: 'none',
                    complexity_kinds: true,
                    // imports: missing
                },
                canonical_fixture: null,
                baseline_tier_ratios: null,
                notes: [],
            },
        ];
        expect(() => supportMatrixSchema.parse(bad)).toThrow();
    });

    it('rejects a record with an unknown key inside features (nested .strict())', () => {
        const bad = [
            {
                key: 'Y',
                display_name: 'Y',
                tier: 'full',
                parse_speed: 'fast',
                features: {
                    noise: true,
                    capabilities: true,
                    di_heuristic: false,
                    receiver_type: 'none',
                    complexity_kinds: true,
                    imports: true,
                    extra_flag: true, // <-- unknown
                },
                canonical_fixture: null,
                baseline_tier_ratios: null,
                notes: [],
            },
        ];
        expect(() => supportMatrixSchema.parse(bad)).toThrow();
    });

    it('rejects baseline_tier_ratios where receiver_min_per_1k_nodes > 500', () => {
        const bad = [
            {
                key: 'Y',
                display_name: 'Y',
                tier: 'full',
                parse_speed: 'fast',
                features: {
                    noise: true,
                    capabilities: true,
                    di_heuristic: false,
                    receiver_type: 'none',
                    complexity_kinds: true,
                    imports: false,
                },
                canonical_fixture: 'tests/fixtures/y',
                baseline_tier_ratios: {
                    resolved_min: 0.5,
                    ambiguous_max: 0.5,
                    receiver_min_per_1k_nodes: 99999,
                    di_min_per_1k_nodes: 0,
                    high_conf_min_ratio: 0.1,
                },
                notes: [],
            },
        ];
        expect(() => supportMatrixSchema.parse(bad)).toThrow();
    });
});

describe('LANGUAGE_SUPPORT consistency', () => {
    it('passes the Zod schema', () => {
        expect(() => supportMatrixSchema.parse(LANGUAGE_SUPPORT)).not.toThrow();
    });

    it('covers every registered extractor (no missing languages)', () => {
        const registered = new Set(listRegisteredLanguages());
        const matrixKeys = new Set(LANGUAGE_SUPPORT.map((r) => r.key));
        for (const key of registered) {
            expect(matrixKeys.has(key)).toBe(true);
        }
    });

    it('contains no ghost entries (every matrix key has a registered extractor)', () => {
        const registered = new Set(listRegisteredLanguages());
        for (const record of LANGUAGE_SUPPORT) {
            expect(registered.has(record.key)).toBe(true);
        }
    });

    it('all "full"-tier records have a canonical_fixture and baseline_tier_ratios', () => {
        for (const r of LANGUAGE_SUPPORT) {
            if (r.tier === 'full') {
                expect(r.canonical_fixture).not.toBeNull();
                expect(r.baseline_tier_ratios).not.toBeNull();
            }
        }
    });
});

describe('markdown generator output', () => {
    it('produces a file that contains every LANGUAGE_SUPPORT display_name', async () => {
        const md = await Bun.file('docs/language-support-matrix.md').text();
        for (const r of LANGUAGE_SUPPORT) {
            expect(md).toContain(r.display_name);
        }
    });

    it('contains the matrix row header', async () => {
        const md = await Bun.file('docs/language-support-matrix.md').text();
        expect(md).toContain('| Language | Tier | Parse |');
    });

    it('contains the auto-generation preamble', async () => {
        const md = await Bun.file('docs/language-support-matrix.md').text();
        expect(md).toContain('Auto-generated from `src/languages/support-matrix.ts`');
    });
});
