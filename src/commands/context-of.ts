import { computeContextOf } from '../analysis/context-of';
import { loadGraph } from '../graph/loader';
import { writeOutput } from '../shared/write-output';

interface ContextOfCommandOptions {
    graph: string;
    out: string;
    symbol: string;
    limit: number;
}

export function executeContextOf(opts: ContextOfCommandOptions): void {
    const graph = loadGraph(opts.graph);
    const result = computeContextOf(graph, { symbol: opts.symbol, limit: opts.limit });

    writeOutput(opts.out, JSON.stringify(result, null, 2));
    if (!result.found) {
        process.stderr.write(`context-of: symbol not found: ${opts.symbol}\n`);
        return;
    }
    process.stderr.write(
        `context-of ${opts.symbol}: ${result.callers.length} caller(s), ${result.callees.length} callee(s), ${result.uses_types.length} type(s), ${result.tested_by.length} test(s)${result.truncated ? ' (truncated)' : ''}\n`,
    );
}
