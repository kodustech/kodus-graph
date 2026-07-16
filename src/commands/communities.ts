import { detectCommunities } from '../analysis/communities';
import { detectTopologicalCommunities } from '../analysis/topological-communities';
import { loadGraph } from '../graph/loader';
import { writeOutput } from '../shared/write-output';

interface CommunitiesCommandOptions {
    graph: string;
    out: string;
    minSize: number;
    depth: number;
    /** Cluster by call-graph topology (Louvain modularity) instead of directory. */
    topological: boolean;
    /** How many hubs/bridges to report in topological mode. */
    topN: number;
}

export function executeCommunities(opts: CommunitiesCommandOptions): void {
    const graph = loadGraph(opts.graph);

    if (opts.topological) {
        const result = detectTopologicalCommunities(graph, { minSize: opts.minSize, topN: opts.topN });
        writeOutput(opts.out, JSON.stringify(result, null, 2));
        process.stderr.write(
            `Communities (topological): ${result.summary.total_communities} detected across ${result.summary.clustered_nodes} nodes, modularity ${result.summary.modularity}, ${result.hubs.length} hubs, ${result.bridges.length} bridges\n`,
        );
        return;
    }

    const result = detectCommunities(graph, { depth: opts.depth, minSize: opts.minSize });
    writeOutput(opts.out, JSON.stringify(result, null, 2));
    process.stderr.write(
        `Communities: ${result.summary.total_communities} detected, avg cohesion ${result.summary.avg_cohesion}, ${result.summary.high_coupling_pairs} high-coupling pairs\n`,
    );
}
