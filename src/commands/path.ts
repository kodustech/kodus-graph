import { computePath } from '../analysis/path-query';
import { loadGraph } from '../graph/loader';
import type { EdgeKind } from '../graph/types';
import { writeOutput } from '../shared/write-output';

interface PathCommandOptions {
    graph: string;
    out: string;
    from: string;
    to: string;
    kinds?: string[];
    maxDepth: number;
}

export function executePath(opts: PathCommandOptions): void {
    const graph = loadGraph(opts.graph);
    const result = computePath(graph, {
        from: opts.from,
        to: opts.to,
        kinds: opts.kinds as EdgeKind[] | undefined,
        maxDepth: opts.maxDepth,
    });

    writeOutput(opts.out, JSON.stringify(result, null, 2));
    if (!result.found) {
        process.stderr.write(`path: no path from ${opts.from} to ${opts.to} within depth ${opts.maxDepth}\n`);
        return;
    }
    const trail = result.path.map((s) => s.qualified_name).join(' → ');
    process.stderr.write(`path (${result.length} hops): ${trail}\n`);
}
