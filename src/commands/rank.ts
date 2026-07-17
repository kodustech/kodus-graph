import { computeRanking } from '../analysis/ranking';
import { loadGraph } from '../graph/loader';
import { writeOutput } from '../shared/write-output';

interface RankCommandOptions {
    graph: string;
    out: string;
    top: number;
    file?: string;
    kind?: string;
}

export function executeRank(opts: RankCommandOptions): void {
    const graph = loadGraph(opts.graph);
    const result = computeRanking(graph, { top: opts.top, file: opts.file, kind: opts.kind });

    writeOutput(opts.out, JSON.stringify(result, null, 2));
    const scope = opts.file ? ` in ${opts.file}` : '';
    const topName = result[0] ? ` — top: ${result[0].qualified_name} (${result[0].score})` : '';
    process.stderr.write(`rank: ${result.length} symbol(s)${scope}${topName}\n`);
}
