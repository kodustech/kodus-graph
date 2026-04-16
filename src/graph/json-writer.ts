import { closeSync, openSync, writeSync } from 'fs';
import type { GraphEdge, GraphNode, ParseMetadata } from './types';

/**
 * Write graph output as JSON using incremental serialization.
 *
 * Instead of JSON.stringify on the full output (which creates a ~100-300 MB
 * string for large repos), this writes each node/edge individually.
 * Peak memory: only one JSON.stringify(singleNode) string at a time (~1 KB).
 *
 * When `out === '-'`, writes to stdout instead of a file. This is useful
 * for Unix pipes (e.g. `kodus-graph parse --out - | jq '.nodes'`).
 */
export function writeGraphJSON(out: string, metadata: ParseMetadata, nodes: GraphNode[], edges: GraphEdge[]): void {
    const useStdout = out === '-';
    const fd = useStdout ? null : openSync(out, 'w');

    const write = (s: string): void => {
        if (useStdout) {
            process.stdout.write(s);
        } else {
            writeSync(fd as number, s);
        }
    };

    try {
        write('{"metadata":');
        write(JSON.stringify(metadata));

        // Nodes
        write(',"nodes":[');
        for (let i = 0; i < nodes.length; i++) {
            if (i > 0) {
                write(',');
            }
            write('\n');
            write(JSON.stringify(nodes[i]));
        }
        write('\n]');

        // Edges
        write(',"edges":[');
        for (let i = 0; i < edges.length; i++) {
            if (i > 0) {
                write(',');
            }
            write('\n');
            write(JSON.stringify(edges[i]));
        }
        write('\n]}');
        if (useStdout) {
            write('\n');
        }
    } finally {
        if (fd !== null) {
            closeSync(fd);
        }
    }
}
