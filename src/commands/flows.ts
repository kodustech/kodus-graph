import { writeFileSync } from 'fs';
import { detectFlows } from '../analysis/flows';
import { loadGraph } from '../graph/loader';

interface FlowsCommandOptions {
  graph: string;
  out: string;
  maxDepth: number;
  type: 'test' | 'http' | 'all';
}

export function executeFlows(opts: FlowsCommandOptions): void {
  const graph = loadGraph(opts.graph);
  const result = detectFlows(graph, { maxDepth: opts.maxDepth, type: opts.type });
  writeFileSync(opts.out, JSON.stringify(result, null, 2));
  process.stderr.write(
    `Flows: ${result.summary.total_flows} detected (test:${result.summary.by_type.test} http:${result.summary.by_type.http}), avg depth ${result.summary.avg_depth}\n`,
  );
}
