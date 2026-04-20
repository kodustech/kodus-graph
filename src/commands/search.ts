import { findCallees, findCallers, searchNodes } from '../analysis/search';
import { loadGraph } from '../graph/loader';
import type { GraphNode } from '../graph/types';
import { writeOutput } from '../shared/write-output';

interface SearchCommandOptions {
    graph: string;
    query?: string;
    kind?: string;
    file?: string;
    callersOf?: string;
    calleesOf?: string;
    limit: number;
    out?: string;
}

export function executeSearch(opts: SearchCommandOptions): void {
    const graph = loadGraph(opts.graph);

    let results: GraphNode[];
    let total: number;
    let queryInfo: Record<string, string | null>;

    if (opts.callersOf) {
        const all = findCallers(graph, opts.callersOf);
        total = all.length;
        results = all.slice(0, opts.limit);
        queryInfo = { callers_of: opts.callersOf, kind: null, file: null };
    } else if (opts.calleesOf) {
        const all = findCallees(graph, opts.calleesOf);
        total = all.length;
        results = all.slice(0, opts.limit);
        queryInfo = { callees_of: opts.calleesOf, kind: null, file: null };
    } else {
        const all = searchNodes(graph, {
            query: opts.query,
            kind: opts.kind,
            file: opts.file,
            // searchNodes already applies limit internally; request the full
            // set so we can report an honest `total` alongside the truncated
            // `results`.
        });
        total = all.length;
        results = all.slice(0, opts.limit);
        queryInfo = { pattern: opts.query || null, kind: opts.kind || null, file: opts.file || null };
    }

    // `total` reports pre-limit count so consumers can tell when results
    // were truncated. Previously `total` just echoed `results.length`, which
    // meant callers-of/callees-of silently ignored --limit.
    const output = JSON.stringify({ results, total, returned: results.length, query: queryInfo }, null, 2);

    if (opts.out && opts.out !== '-') {
        writeOutput(opts.out, output);
    } else {
        process.stdout.write(`${output}\n`);
    }
}
