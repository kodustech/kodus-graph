import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_RISK_CONFIG, loadRiskConfig, type RiskConfig } from '../../src/analysis/risk-config';
import { computeRiskScore } from '../../src/analysis/risk-score';
import type { BlastRadiusResult, GraphData } from '../../src/graph/types';

const emptyBlast: BlastRadiusResult = { total_functions: 0, total_files: 0, by_depth: {} };
const emptyGraph: GraphData = { nodes: [], edges: [] };

describe('risk-config', () => {
    it('DEFAULT_RISK_CONFIG weights sum to 1.0', () => {
        const w = DEFAULT_RISK_CONFIG.weights;
        expect(w.blast_radius + w.test_gaps + w.complexity + w.inheritance).toBeCloseTo(1.0, 6);
    });

    it('computeRiskScore uses default weights when no config passed', () => {
        const result = computeRiskScore(emptyGraph, [], emptyBlast);
        expect(result.factors.blast_radius.weight).toBe(DEFAULT_RISK_CONFIG.weights.blast_radius);
    });

    it('computeRiskScore honors custom weights', () => {
        const cfg: RiskConfig = {
            weights: { blast_radius: 0.5, test_gaps: 0.2, complexity: 0.2, inheritance: 0.1 },
            caps: DEFAULT_RISK_CONFIG.caps,
        };
        const result = computeRiskScore(emptyGraph, [], emptyBlast, { riskConfig: cfg });
        expect(result.factors.blast_radius.weight).toBe(0.5);
    });

    it('rejects configs whose weights do not sum to 1.0', () => {
        const cfg = {
            weights: { blast_radius: 0.5, test_gaps: 0.5, complexity: 0.5, inheritance: 0.5 },
            caps: DEFAULT_RISK_CONFIG.caps,
        } as RiskConfig;
        expect(() => computeRiskScore(emptyGraph, [], emptyBlast, { riskConfig: cfg })).toThrow(
            /weights must sum to 1/,
        );
    });

    it('caps.blast_functions changes blast_radius normalization', () => {
        const blast: BlastRadiusResult = { total_functions: 10, total_files: 1, by_depth: {} };
        const cfgCap20: RiskConfig = {
            weights: DEFAULT_RISK_CONFIG.weights,
            caps: { ...DEFAULT_RISK_CONFIG.caps, blast_functions: 20 },
        };
        const cfgCap5: RiskConfig = {
            weights: DEFAULT_RISK_CONFIG.weights,
            caps: { ...DEFAULT_RISK_CONFIG.caps, blast_functions: 5 },
        };
        const resultCap20 = computeRiskScore(emptyGraph, [], blast, { riskConfig: cfgCap20 });
        const resultCap5 = computeRiskScore(emptyGraph, [], blast, { riskConfig: cfgCap5 });
        expect(resultCap20.factors.blast_radius.value).toBe(0.5);
        expect(resultCap5.factors.blast_radius.value).toBe(1);
        expect(resultCap20.factors.blast_radius.value).not.toBe(resultCap5.factors.blast_radius.value);
    });

    describe('loadRiskConfig', () => {
        it('loads a valid config from disk', () => {
            const tmpDir = mkdtempSync(join(tmpdir(), 'risk-config-valid-'));
            try {
                const configPath = join(tmpDir, 'risk.json');
                const contents = {
                    weights: {
                        blast_radius: 0.4,
                        test_gaps: 0.3,
                        complexity: 0.2,
                        inheritance: 0.1,
                    },
                    caps: { blast_functions: 25, cyclomatic: 12, lines_of_code: 60 },
                };
                writeFileSync(configPath, JSON.stringify(contents), 'utf-8');
                const loaded = loadRiskConfig(configPath);
                expect(loaded.weights.blast_radius).toBe(0.4);
                expect(loaded.weights.test_gaps).toBe(0.3);
                expect(loaded.weights.complexity).toBe(0.2);
                expect(loaded.weights.inheritance).toBe(0.1);
                expect(loaded.caps.blast_functions).toBe(25);
                expect(loaded.caps.cyclomatic).toBe(12);
                expect(loaded.caps.lines_of_code).toBe(60);
            } finally {
                rmSync(tmpDir, { recursive: true });
            }
        });

        it('rejects malformed JSON', () => {
            const tmpDir = mkdtempSync(join(tmpdir(), 'risk-config-badjson-'));
            try {
                const configPath = join(tmpDir, 'risk.json');
                writeFileSync(configPath, 'this is not json', 'utf-8');
                expect(() => loadRiskConfig(configPath)).toThrow();
            } finally {
                rmSync(tmpDir, { recursive: true });
            }
        });

        it('rejects zod violations (weight out of range)', () => {
            const tmpDir = mkdtempSync(join(tmpdir(), 'risk-config-outofrange-'));
            try {
                const configPath = join(tmpDir, 'risk.json');
                const contents = {
                    weights: {
                        blast_radius: 1.5,
                        test_gaps: 0.3,
                        complexity: 0.2,
                        inheritance: 0.1,
                    },
                    caps: { blast_functions: 20, complexity: 50 },
                };
                writeFileSync(configPath, JSON.stringify(contents), 'utf-8');
                expect(() => loadRiskConfig(configPath)).toThrow();
            } finally {
                rmSync(tmpDir, { recursive: true });
            }
        });

        it('rejects unknown keys (strict schema)', () => {
            const tmpDir = mkdtempSync(join(tmpdir(), 'risk-config-unknown-'));
            try {
                const configPath = join(tmpDir, 'risk.json');
                const contents = {
                    weights: {
                        blast_radius: 0.35,
                        test_gaps: 0.3,
                        complexity: 0.2,
                        inheritance: 0.15,
                        foobar: 0.1,
                    },
                    caps: { blast_functions: 20, complexity: 50 },
                };
                writeFileSync(configPath, JSON.stringify(contents), 'utf-8');
                expect(() => loadRiskConfig(configPath)).toThrow();
            } finally {
                rmSync(tmpDir, { recursive: true });
            }
        });
    });
});
