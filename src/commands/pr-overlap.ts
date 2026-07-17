import { computePrOverlap, symbolsInFiles } from '../analysis/pr-overlap';
import { loadGraph } from '../graph/loader';
import { writeOutput } from '../shared/write-output';

interface PrOverlapCommandOptions {
    graph: string;
    out: string;
    /** Changed symbols (qualified names) for PR A. Takes precedence over aFiles. */
    a?: string[];
    b?: string[];
    /** Changed files for PR A — expanded to every symbol they declare. */
    aFiles?: string[];
    bFiles?: string[];
    maxDepth: number;
    minConfidence: number;
}

export function executePrOverlap(opts: PrOverlapCommandOptions): void {
    const graph = loadGraph(opts.graph);

    const changedA = opts.a?.length ? opts.a : symbolsInFiles(graph, opts.aFiles ?? []);
    const changedB = opts.b?.length ? opts.b : symbolsInFiles(graph, opts.bFiles ?? []);

    const result = computePrOverlap(graph, {
        changedA,
        changedB,
        maxDepth: opts.maxDepth,
        minConfidence: opts.minConfidence,
    });

    writeOutput(opts.out, JSON.stringify(result, null, 2));
    process.stderr.write(
        `PR overlap: ${result.level} — ${result.reason} (shared: ${result.shared_changed.length}, A→B: ${result.a_impacts_b.length}, B→A: ${result.b_impacts_a.length})\n`,
    );
}
