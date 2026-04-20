import { describe, expect, it } from 'bun:test';
import { type LanguageSupportRecord, supportMatrixSchema } from '../src/languages/support-matrix-schema';

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
