import { describe, expect, it } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { executeParse } from '../../src/commands/parse';
import { executeUpdate } from '../../src/commands/update';

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

    it('CALLS edges carry a `tier` field and tier counts equal CALLS-edge tiers', async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'kodus-graph-tier-edges-'));
        try {
            const outPath = join(tmp, 'graph.json');
            await executeParse({ repoDir: FIXTURE_REPO, all: true, out: outPath });
            const output = JSON.parse(readFileSync(outPath, 'utf-8'));
            const callsEdges = output.edges.filter((e: { kind: string }) => e.kind === 'CALLS');
            expect(callsEdges.length).toBeGreaterThan(0);
            const tierCounts: Record<string, number> = {};
            for (const e of callsEdges) {
                expect(e.tier).toBeDefined();
                tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1;
            }
            const td = output.metadata.tier_distribution;
            const edgeTiers = ['receiver', 'di', 'same', 'import', 'unique', 'ambiguous'] as const;
            for (const t of edgeTiers) {
                expect(td[t]).toBe(tierCounts[t] ?? 0);
            }
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('update merges tier_distribution across old + new edges, not just the slice', async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'kodus-graph-tier-update-'));
        try {
            const repoCopy = join(tmp, 'repo');
            cpSync(FIXTURE_REPO, repoCopy, { recursive: true });
            const graphPath = join(repoCopy, 'graph.json');

            await executeParse({ repoDir: repoCopy, all: true, out: graphPath });
            const baseline = JSON.parse(readFileSync(graphPath, 'utf-8'));
            const baselineEdges = (baseline.edges as { kind: string }[]).filter((e) => e.kind === 'CALLS').length;

            // Touch a single file with a no-op edit to trigger reparse of just that file.
            const touched = join(repoCopy, 'src/auth.ts');
            const original = readFileSync(touched, 'utf-8');
            writeFileSync(touched, `${original}\n// touch\n`);

            await executeUpdate({ repoDir: repoCopy, graph: 'graph.json' });
            const merged = JSON.parse(readFileSync(graphPath, 'utf-8'));

            expect(merged.metadata.incremental).toBe(true);
            const mergedEdges = merged.edges as { kind: string; file_path: string }[];
            const mergedCallsEdges = mergedEdges.filter((e) => e.kind === 'CALLS').length;
            const sliceCallsEdges = mergedEdges.filter(
                (e) => e.kind === 'CALLS' && e.file_path === 'src/auth.ts',
            ).length;

            // Sum of edge-tier counts in the merged tier_distribution must equal merged CALLS-edge count
            // (proves we counted ALL edges, not just the slice).
            const mtd = merged.metadata.tier_distribution;
            const sumEdgeTiers = mtd.receiver + mtd.di + mtd.same + mtd.import + mtd.unique + mtd.ambiguous;
            expect(sumEdgeTiers).toBe(mergedCallsEdges);
            // And that's strictly more than the slice alone — old behavior would have summed
            // ~sliceCallsEdges. The merged total is meaningfully larger.
            expect(sumEdgeTiers).toBeGreaterThan(sliceCallsEdges);
            // Sanity: baseline had a non-zero count too.
            expect(baselineEdges).toBeGreaterThan(0);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});
