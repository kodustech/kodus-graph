import { symbolsInFiles } from '../analysis/pr-overlap';
import { computeSubsystemContext } from '../analysis/subsystem-context';
import { loadGraph } from '../graph/loader';
import { writeOutput } from '../shared/write-output';

interface SubsystemContextCommandOptions {
    graph: string;
    out: string;
    /** Changed symbols (qualified names). Takes precedence over files. */
    changed?: string[];
    /** Changed files — expanded to the symbols they declare if --changed is omitted. */
    files?: string[];
    topN: number;
    minSize: number;
}

export function executeSubsystemContext(opts: SubsystemContextCommandOptions): void {
    const graph = loadGraph(opts.graph);
    const changed = opts.changed?.length ? opts.changed : symbolsInFiles(graph, opts.files ?? []);

    const result = computeSubsystemContext(graph, {
        changed,
        topN: opts.topN,
        minCommunitySize: opts.minSize,
    });

    writeOutput(opts.out, JSON.stringify(result, null, 2));
    const subsystemNote = result.subsystems.length
        ? result.subsystems.map((s) => `#${s.id} (${s.size} nodes)`).join(', ')
        : 'none detected';
    process.stderr.write(
        `Subsystem context: ${result.subsystems.length} module(s) [${subsystemNote}], ${result.hubs_touched.length} hub(s), ${result.bridges_touched.length} bridge(s), ${result.callers.length} caller(s), ${result.callees.length} callee(s)\n`,
    );
}
