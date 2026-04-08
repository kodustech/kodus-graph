import type { IndexedGraph } from '../graph/loader';

export interface FlowOptions {
    maxDepth: number;
    type: 'test' | 'http' | 'all';
}

export interface Flow {
    entry_point: string;
    type: 'test' | 'http';
    depth: number;
    node_count: number;
    file_count: number;
    criticality: number;
    path: string[];
}

export interface FlowsResult {
    flows: Flow[];
    summary: {
        total_flows: number;
        by_type: { test: number; http: number };
        avg_depth: number;
        max_criticality: number;
    };
}

const HTTP_METHOD_NAMES = new Set(['get', 'post', 'put', 'delete', 'patch', 'handle', 'handler']);

function isHttpHandler(_qualifiedName: string, name: string, parentName?: string): boolean {
    if (HTTP_METHOD_NAMES.has(name.toLowerCase())) {
        return true;
    }
    if (parentName?.toLowerCase().endsWith('controller')) {
        return true;
    }
    return false;
}

export function detectFlows(graph: IndexedGraph, opts: FlowOptions): FlowsResult {
    const { maxDepth, type } = opts;

    // Find entry points
    const entryPoints: { qualified: string; type: 'test' | 'http' }[] = [];

    for (const node of graph.nodes) {
        if (type !== 'http' && node.kind === 'Test') {
            entryPoints.push({ qualified: node.qualified_name, type: 'test' });
        }
        if (type !== 'test' && (node.kind === 'Method' || node.kind === 'Function')) {
            if (isHttpHandler(node.qualified_name, node.name, node.parent_name)) {
                entryPoints.push({ qualified: node.qualified_name, type: 'http' });
            }
        }
    }

    // BFS for each entry point
    const flows: Flow[] = [];

    for (const ep of entryPoints) {
        const path: string[] = [ep.qualified];
        const visited = new Set<string>([ep.qualified]);
        const files = new Set<string>();

        const startNode = graph.byQualified.get(ep.qualified);
        if (startNode) {
            files.add(startNode.file_path);
        }

        let frontier = [ep.qualified];
        let depth = 0;

        while (frontier.length > 0 && depth < maxDepth) {
            const next: string[] = [];
            for (const q of frontier) {
                for (const edge of graph.adjacency.get(q) || []) {
                    if (edge.kind !== 'CALLS') {
                        continue;
                    }
                    if (visited.has(edge.target_qualified)) {
                        continue;
                    }
                    visited.add(edge.target_qualified);
                    next.push(edge.target_qualified);
                    path.push(edge.target_qualified);
                    const targetNode = graph.byQualified.get(edge.target_qualified);
                    if (targetNode) {
                        files.add(targetNode.file_path);
                    }
                }
            }
            if (next.length === 0) {
                break;
            }
            frontier = next;
            depth++;
        }

        flows.push({
            entry_point: ep.qualified,
            type: ep.type,
            depth,
            node_count: visited.size,
            file_count: files.size,
            criticality: visited.size * files.size,
            path,
        });
    }

    flows.sort((a, b) => b.criticality - a.criticality);

    const testFlows = flows.filter((f) => f.type === 'test').length;
    const httpFlows = flows.filter((f) => f.type === 'http').length;
    const avgDepth =
        flows.length > 0 ? Math.round((flows.reduce((s, f) => s + f.depth, 0) / flows.length) * 10) / 10 : 0;
    const maxCriticality = flows.length > 0 ? flows[0].criticality : 0;

    return {
        flows,
        summary: {
            total_flows: flows.length,
            by_type: { test: testFlows, http: httpFlows },
            avg_depth: avgDepth,
            max_criticality: maxCriticality,
        },
    };
}
