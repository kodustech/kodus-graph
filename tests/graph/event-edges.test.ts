import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeParse } from '../../src/commands/parse';

// Import to trigger language registration.
import '../../src/parser/languages';

/**
 * #2 — heuristic event-coupling edges.
 *
 * `bus.emit('user.created', …)` / `@OnEvent('user.created')` couple an emitter
 * to a handler through a literal channel name that no name-based resolver tier
 * can see (the callee is the generic method `emit`, dropped as noise). Before
 * this feature the emitter's function and the handler were completely
 * disconnected in the graph. The builder now synthesizes a CALLS edge
 * emitter→handler tagged `provenance:'heuristic'` at a low confidence and no
 * tier, so it enters the blast radius as a labelled guess without ever passing
 * for a statically-verified call.
 */

interface Edge {
    kind: string;
    source_qualified: string;
    target_qualified: string;
    tier?: string;
    provenance?: string;
    confidence?: number;
}

async function edgesFor(fileName: string, source: string): Promise<Edge[]> {
    const tmp = mkdtempSync(join(tmpdir(), 'kodus-graph-event-'));
    try {
        writeFileSync(join(tmp, fileName), source);
        const outPath = join(tmp, 'graph.json');
        await executeParse({ repoDir: tmp, all: true, out: outPath });
        const graph = JSON.parse(readFileSync(outPath, 'utf-8'));
        return graph.edges as Edge[];
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

const heuristicEdges = (edges: Edge[]) => edges.filter((e) => e.kind === 'CALLS' && e.provenance === 'heuristic');

describe('event-coupling heuristic edges', () => {
    it('connects emit() to an @OnEvent() handler by literal channel', async () => {
        const edges = await edgesFor(
            'a.ts',
            `
class Emitter {
  constructor(private ee: EventEmitter2) {}
  doThing() {
    this.ee.emit('user.created', { id: 1 });
  }
}
class Listener {
  @OnEvent('user.created')
  handleUserCreated(payload: any) { return payload.id; }
}
`,
        );

        const evt = heuristicEdges(edges);
        expect(evt).toHaveLength(1);
        expect(evt[0].source_qualified).toContain('doThing');
        expect(evt[0].target_qualified).toContain('handleUserCreated');
        // Labelled as a guess: low confidence, no resolver tier.
        expect(evt[0].confidence).toBe(0.5);
        expect(evt[0].tier).toBeUndefined();
    });

    it('connects emit() to an .on() listener by literal channel', async () => {
        const edges = await edgesFor(
            'b.ts',
            `
function fire(bus: any) {
  bus.emit('job.done', 1);
}
function register(bus: any) {
  bus.on('job.done', (n: number) => n + 1);
}
`,
        );
        const evt = heuristicEdges(edges);
        expect(evt).toHaveLength(1);
        expect(evt[0].source_qualified).toContain('fire');
        expect(evt[0].target_qualified).toContain('register');
    });

    it('does NOT synthesize an edge when only the emitter side exists', async () => {
        const edges = await edgesFor(
            'c.ts',
            `
function fire(bus: any) {
  bus.emit('orphan.event', 1);
}
`,
        );
        expect(heuristicEdges(edges)).toHaveLength(0);
    });

    it('does NOT couple across different channels', async () => {
        const edges = await edgesFor(
            'd.ts',
            `
function fire(bus: any) { bus.emit('a', 1); }
function listen(bus: any) { bus.on('b', () => {}); }
`,
        );
        expect(heuristicEdges(edges)).toHaveLength(0);
    });

    it('ignores an interpolated (non-constant) channel', async () => {
        const edges = await edgesFor(
            'e.ts',
            `
function fire(bus: any, id: string) { bus.emit(\`user.\${id}\`, 1); }
class L { @OnEvent('user.created') h() {} }
`,
        );
        expect(heuristicEdges(edges)).toHaveLength(0);
    });
});
