import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readGraphFile } from '../../src/graph/graph-file';
import { writeGraphJSON } from '../../src/graph/json-writer';
import type { GraphEdge, GraphNode, ParseMetadata } from '../../src/graph/types';

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) {
        rmSync(d, { recursive: true, force: true });
    }
});
const tmp = (name: string) => {
    const d = mkdtempSync(join(tmpdir(), 'kodus-graph-graph-file-'));
    dirs.push(d);
    return join(d, name);
};

const metadata: ParseMetadata = {
    repo_dir: '/repo',
    files_parsed: 2,
    total_nodes: 2,
    total_edges: 1,
    duration_ms: 1,
    parse_errors: 0,
    extract_errors: 0,
};
const node = (name: string, params = '()'): GraphNode => ({
    kind: 'Function',
    name,
    qualified_name: `src/a.ts::${name}`,
    file_path: 'src/a.ts',
    line_start: 0,
    line_end: 2,
    language: 'TypeScript',
    is_test: false,
    params,
});
const edge: GraphEdge = {
    kind: 'CALLS',
    source_qualified: 'src/a.ts::a',
    target_qualified: 'src/a.ts::b',
    file_path: 'src/a.ts',
    line: 1,
    confidence: 0.3,
    alternatives: ['src/c.ts::b'],
};

describe('readGraphFile', () => {
    it('reads what writeGraphJSON writes, identical to JSON.parse', () => {
        const p = tmp('g.json');
        // Multi-byte text in a field: a small chunk size forces reads to split it.
        const nodes = [node('a', '(label: "café — 日本語 ✓")'), node('b')];
        writeGraphJSON(p, metadata, nodes, [edge]);
        expect(readGraphFile(p, { stream: true, chunkBytes: 7 })).toEqual({ metadata, nodes, edges: [edge] });
        expect(readGraphFile(p)).toEqual({ metadata, nodes, edges: [edge] });
    });

    it('handles a graph with no nodes or edges', () => {
        const p = tmp('empty.json');
        writeGraphJSON(p, metadata, [], []);
        expect(readGraphFile(p, { stream: true, chunkBytes: 5 })).toEqual({ metadata, nodes: [], edges: [] });
    });

    it('reads other layouts (jq -c, pretty-printed) through the whole-file parse', () => {
        const value = { metadata, nodes: [node('a')], edges: [edge] };
        const oneLine = tmp('one-line.json');
        writeFileSync(oneLine, JSON.stringify(value));
        expect(readGraphFile(oneLine)).toEqual(value);
        const pretty = tmp('pretty.json');
        writeFileSync(pretty, JSON.stringify(value, null, 2));
        expect(readGraphFile(pretty)).toEqual(value);
    });

    it('surfaces malformed JSON as an error instead of returning a partial graph', () => {
        const p = tmp('broken.json');
        writeFileSync(p, '{"metadata":{},"nodes":[\n{"kind":\n');
        expect(() => readGraphFile(p)).toThrow();
        expect(() => readGraphFile(p, { stream: true })).toThrow();
    });

    it('streams a file above the string limit without first reading it whole', () => {
        // Reading it whole allocates the file's full size, then throws: on the
        // hosts that hit the limit that allocation alone can run out of memory.
        const p = tmp('big.json');
        const nodes = [node('a'), node('b')];
        writeGraphJSON(p, metadata, nodes, [edge]);
        const read = spyOn(fs, 'readFileSync');
        try {
            expect(readGraphFile(p, { maxStringBytes: 10 })).toEqual({ metadata, nodes, edges: [edge] });
            expect(read).not.toHaveBeenCalled();
        } finally {
            read.mockRestore();
        }
    });

    it('still tries the whole-file parse above the limit when the layout is not the writer one', () => {
        // Byte size overstates string length for multi-byte text, so the file may fit.
        const value = { metadata, nodes: [node('a')], edges: [edge] };
        const pretty = tmp('pretty-big.json');
        writeFileSync(pretty, JSON.stringify(value, null, 2));
        expect(readGraphFile(pretty, { maxStringBytes: 10 })).toEqual(value);
    });
});
