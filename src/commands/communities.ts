import { detectCommunities } from '../analysis/communities';
import { loadGraph } from '../graph/loader';
import { writeOutput } from '../shared/write-output';

interface CommunitiesCommandOptions {
    graph: string;
    out: string;
    minSize: number;
    depth: number;
}

export function executeCommunities(opts: CommunitiesCommandOptions): void {
    const graph = loadGraph(opts.graph);
    const result = detectCommunities(graph, { depth: opts.depth, minSize: opts.minSize });
    writeOutput(opts.out, JSON.stringify(result, null, 2));
    process.stderr.write(
        `Communities: ${result.summary.total_communities} detected, avg cohesion ${result.summary.avg_cohesion}, ${result.summary.high_coupling_pairs} high-coupling pairs\n`,
    );
}
