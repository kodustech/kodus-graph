import { closeSync, openSync, writeSync } from 'fs';
import type { GraphEdge, GraphNode, ParseMetadata } from './types';

/**
 * Write graph output as JSON to disk using incremental serialization.
 *
 * Instead of JSON.stringify on the full output (which creates a ~100-300 MB
 * string for large repos), this writes each node/edge individually.
 * Peak memory: only one JSON.stringify(singleNode) string at a time (~1 KB).
 */
export function writeGraphJSON(out: string, metadata: ParseMetadata, nodes: GraphNode[], edges: GraphEdge[]): void {
    const fd = openSync(out, 'w');

    try {
        writeSync(fd, '{"metadata":');
        writeSync(fd, JSON.stringify(metadata));

        // Nodes
        writeSync(fd, ',"nodes":[');
        for (let i = 0; i < nodes.length; i++) {
            if (i > 0) {
                writeSync(fd, ',');
            }
            writeSync(fd, '\n');
            writeSync(fd, JSON.stringify(nodes[i]));
        }
        writeSync(fd, '\n]');

        // Edges
        writeSync(fd, ',"edges":[');
        for (let i = 0; i < edges.length; i++) {
            if (i > 0) {
                writeSync(fd, ',');
            }
            writeSync(fd, '\n');
            writeSync(fd, JSON.stringify(edges[i]));
        }
        writeSync(fd, '\n]}');
    } finally {
        closeSync(fd);
    }
}
