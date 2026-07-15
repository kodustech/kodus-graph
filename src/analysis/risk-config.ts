import { readFileSync } from 'fs';
import { z } from 'zod';

export interface RiskWeights {
    blast_radius: number;
    test_gaps: number;
    complexity: number;
    inheritance: number;
}

export interface RiskCaps {
    /**
     * Affected-function count at which the blast-radius factor saturates.
     *
     * Normalization is logarithmic, not linear — see `risk-score.ts`. The cap is
     * where "wide" stops getting wider, not a divisor.
     */
    blast_functions: number;
    /**
     * Cyclomatic-complexity cap, in decision points. A function at or above this
     * contributes the complexity factor's full weight.
     *
     * 10 is McCabe's recommended per-function ceiling: 1–10 simple, 11–20
     * moderate, 20+ hard to test.
     *
     * Previously a single `complexity` cap of 50 normalized BOTH this and the
     * lines-of-code fallback below. 50 is reasonable for lines and nonsense for
     * decision points: a genuinely gnarly function at cyclomatic 10 scored
     * 10/50 = 0.2, contributing 0.04 of an available 0.20 and leaving the
     * factor all but switched off. The old doc comment described the mismatch
     * and told callers to fix it themselves with --risk-config; the two units
     * now just have two caps.
     */
    cyclomatic: number;
    /**
     * Lines-of-code cap, used only for legacy graphs whose nodes carry no
     * `complexity` field.
     */
    lines_of_code: number;
}

export interface RiskConfig {
    weights: Readonly<RiskWeights>;
    caps: Readonly<RiskCaps>;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = Object.freeze({
    weights: Object.freeze({
        blast_radius: 0.35,
        test_gaps: 0.3,
        complexity: 0.2,
        inheritance: 0.15,
    }),
    caps: Object.freeze({
        blast_functions: 20,
        cyclomatic: 10,
        lines_of_code: 50,
    }),
});

const riskConfigSchema = z
    .object({
        weights: z
            .object({
                blast_radius: z.number().min(0).max(1),
                test_gaps: z.number().min(0).max(1),
                complexity: z.number().min(0).max(1),
                inheritance: z.number().min(0).max(1),
            })
            .strict(),
        caps: z
            .object({
                blast_functions: z.number().positive(),
                cyclomatic: z.number().positive(),
                lines_of_code: z.number().positive(),
            })
            .strict(),
    })
    .strict();

export function validateRiskConfig(cfg: RiskConfig): void {
    const w = cfg.weights;
    const sum = w.blast_radius + w.test_gaps + w.complexity + w.inheritance;
    if (Math.abs(sum - 1.0) > 1e-6) {
        throw new Error(`risk config weights must sum to 1.0 (got ${sum.toFixed(4)})`);
    }
}

export function loadRiskConfig(path: string): RiskConfig {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const parsed = riskConfigSchema.parse(raw);
    validateRiskConfig(parsed);
    return parsed;
}
