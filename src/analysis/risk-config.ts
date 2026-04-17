import { readFileSync } from 'fs';
import { z } from 'zod';

export interface RiskWeights {
    blast_radius: number;
    test_gaps: number;
    complexity: number;
    inheritance: number;
}

export interface RiskCaps {
    /** Blast radius normalization cap (total functions). */
    blast_functions: number;
    /**
     * Complexity normalization cap. Used for cyclomatic complexity on graphs
     * that have the field (default units: decision points), and as a lines-of-code
     * cap for legacy graphs without `complexity`. The default value (50) is
     * calibrated for the LoC fallback; callers reading cyclomatic-heavy graphs
     * should lower it (e.g. 10) via --risk-config.
     */
    complexity: number;
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
        complexity: 50,
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
                complexity: z.number().positive(),
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
