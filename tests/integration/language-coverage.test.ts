import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { executeParse } from '../../src/commands/parse';
import { LANGUAGE_SUPPORT } from '../../src/languages/support-matrix';

// Side-effect imports to populate all registries.
import '../../src/languages/c';
import '../../src/languages/csharp';
import '../../src/languages/dart';
import '../../src/languages/elixir';
import '../../src/languages/go';
import '../../src/languages/java';
import '../../src/languages/kotlin';
import '../../src/languages/php';
import '../../src/languages/python';
import '../../src/languages/ruby';
import '../../src/languages/rust';
import '../../src/languages/scala';
import '../../src/languages/swift';
import '../../src/languages/typescript';

// Languages in the 'full' tier have required baselines; CI asserts them.
const FULL_TIER = LANGUAGE_SUPPORT.filter((r) => r.tier === 'full' && r.baseline_tier_ratios);

describe('language-coverage CI quality gate', () => {
    for (const record of FULL_TIER) {
        it(`${record.display_name}: tier_distribution ratios meet baselines`, async () => {
            // Every 'full' record must have both (schema-enforced, but belt & braces)
            expect(record.canonical_fixture).not.toBeNull();
            expect(record.baseline_tier_ratios).not.toBeNull();

            const fixture = resolve(record.canonical_fixture!);
            const outPath = `/tmp/kodus-lang-coverage-${record.key}.json`;

            await executeParse({
                repoDir: fixture,
                all: true,
                files: [],
                out: outPath,
                skipTests: false,
            });

            const graph = await Bun.file(outPath).json();
            const td = graph.metadata.tier_distribution;
            const nodes = graph.metadata.total_nodes;
            const baselines = record.baseline_tier_ratios!;

            const totalResolved = td.receiver + td.di + td.same + td.import + td.unique + td.ambiguous;
            const totalCallSites = totalResolved + td.noise + td.ambiguousNoise;

            // Protection against fixtures too small to validate. If the fixture
            // has no call sites, the ratios are undefined — skip rather than
            // produce misleading failures.
            if (totalCallSites === 0) {
                console.warn(`skipping ratio check for ${record.key}: fixture has 0 call sites`);
                return;
            }

            const resolvedRatio = totalResolved / totalCallSites;
            const ambiguousRatio = td.ambiguous / (totalResolved || 1);
            const highConfRatio = (td.receiver + td.di + td.same) / (totalResolved || 1);
            const receiverPer1k = (td.receiver * 1000) / (nodes || 1);
            const diPer1k = (td.di * 1000) / (nodes || 1);

            expect(resolvedRatio).toBeGreaterThanOrEqual(baselines.resolved_min);
            expect(ambiguousRatio).toBeLessThanOrEqual(baselines.ambiguous_max);
            expect(receiverPer1k).toBeGreaterThanOrEqual(baselines.receiver_min_per_1k_nodes);
            expect(diPer1k).toBeGreaterThanOrEqual(baselines.di_min_per_1k_nodes);
            expect(highConfRatio).toBeGreaterThanOrEqual(baselines.high_conf_min_ratio);
        });
    }
});
