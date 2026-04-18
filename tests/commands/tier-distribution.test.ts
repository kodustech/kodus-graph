import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { executeParse } from '../../src/commands/parse';

// Import to trigger language registration.
import '../../src/parser/languages';

const FIXTURE_REPO = resolve('tests/fixtures/sample-repo');
const TIER_KEYS = ['receiver', 'di', 'same', 'import', 'unique', 'ambiguous', 'noise', 'ambiguousNoise'] as const;

describe('tier_distribution in ParseMetadata', () => {
    it('is populated when parsing a repo with CALLS', async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'kodus-graph-tier-'));
        try {
            const outPath = join(tmp, 'graph.json');
            await executeParse({
                repoDir: FIXTURE_REPO,
                all: true,
                out: outPath,
            });
            const output = JSON.parse(readFileSync(outPath, 'utf-8'));
            expect(output.metadata.tier_distribution).toBeDefined();
            const td = output.metadata.tier_distribution as Record<string, number>;
            for (const key of TIER_KEYS) {
                expect(typeof td[key]).toBe('number');
                expect(td[key]).toBeGreaterThanOrEqual(0);
            }
            const sum = TIER_KEYS.reduce((acc, k) => acc + td[k], 0);
            expect(sum).toBeGreaterThan(0);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});
