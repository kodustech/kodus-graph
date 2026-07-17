import { computeStatus } from '../analysis/status';
import { loadGraph } from '../graph/loader';
import { writeOutput } from '../shared/write-output';

interface StatusCommandOptions {
    graph: string;
    out: string;
    repoDir: string;
}

export function executeStatus(opts: StatusCommandOptions): void {
    const graph = loadGraph(opts.graph);
    const result = computeStatus(graph, { repoDir: opts.repoDir });

    writeOutput(opts.out, JSON.stringify(result, null, 2));
    process.stderr.write(
        `status: ${result.up_to_date ? 'up to date' : 'STALE'} — ${result.fresh}/${result.total_files} fresh, ${result.stale.length} changed, ${result.deleted.length} deleted${result.unknown.length ? `, ${result.unknown.length} unhashed` : ''}\n`,
    );
}
