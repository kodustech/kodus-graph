import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeParse } from '../../src/commands/parse';

// Import to trigger language registration.
import '../../src/parser/languages';

/**
 * Java unqualified (implicit-`this`) call resolution.
 *
 * Real Keycloak PR regression: a subclass calling an INHERITED method the
 * idiomatic Java way — `printFeatureDisabled()` with no `this.` prefix —
 * resolved at the weak name cascade (`unique`, 0.50-0.60) instead of walking the
 * class hierarchy to the base that declares it (`same`, 0.85). The graph then
 * labelled a correct edge low-confidence, so the reviewer discounted it. The
 * fix tags unqualified calls with the enclosing class so the class tier resolves
 * them through inheritance.
 */

interface Edge {
    kind: string;
    source_qualified: string;
    target_qualified: string;
    confidence?: number;
    tier?: string;
}

async function edgesFor(files: Record<string, string>): Promise<{ edges: Edge[]; cleanup: () => void }> {
    const tmp = mkdtempSync(join(tmpdir(), 'kodus-graph-java-'));
    for (const [name, src] of Object.entries(files)) {
        writeFileSync(join(tmp, name), src);
    }
    const outPath = join(tmp, 'graph.json');
    await executeParse({ repoDir: tmp, all: true, out: outPath });
    const graph = JSON.parse(readFileSync(outPath, 'utf-8'));
    return { edges: graph.edges as Edge[], cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

describe('Java unqualified inherited-call resolution', () => {
    it('resolves an unqualified inherited call via the hierarchy (same, 0.85), not the unique cascade', async () => {
        const { edges, cleanup } = await edgesFor({
            'AbstractCmd.java': `package a;
public abstract class AbstractCmd {
    protected void printDisabled() { System.out.println("x"); }
}`,
            'SubCmd.java': `package a;
public class SubCmd extends AbstractCmd {
    public void run() {
        printDisabled();
        this.printDisabled();
    }
}`,
        });
        try {
            const calls = edges.filter(
                (e) => e.kind === 'CALLS' && e.target_qualified.endsWith('AbstractCmd.printDisabled'),
            );
            // Both the implicit-this and explicit-this call resolve to the base method.
            expect(calls.length).toBeGreaterThanOrEqual(1);
            for (const c of calls) {
                expect(c.source_qualified).toContain('SubCmd.run');
                // The whole point: NOT the weak unique tier.
                expect(c.tier).not.toBe('unique');
                expect(c.confidence ?? 0).toBeGreaterThanOrEqual(0.85);
            }
        } finally {
            cleanup();
        }
    });
});
