import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { computeStatus } from '../../src/analysis/status';
import { indexGraph } from '../../src/graph/loader';
import type { GraphData } from '../../src/graph/types';
import { computeFileHash } from '../../src/shared/file-hash';

let dir: string;
let freshHash: string;

function node(file: string, hash?: string): GraphData['nodes'][number] {
    return {
        kind: 'Function',
        name: 'f',
        qualified_name: `${file}::f`,
        file_path: file,
        line_start: 1,
        line_end: 2,
        language: 'typescript',
        is_test: false,
        ...(hash ? { file_hash: hash } : {}),
    };
}

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kg-status-'));
    writeFileSync(join(dir, 'fresh.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'changed.ts'), 'export const y = 2;\n');
    freshHash = computeFileHash(join(dir, 'fresh.ts'));
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('computeStatus', () => {
    it('classifies files as fresh, stale, or deleted against disk', () => {
        const graph: GraphData = {
            nodes: [
                node('fresh.ts', freshHash), // hash matches disk → fresh
                node('changed.ts', 'deadbeef'), // stored hash is wrong → stale
                node('gone.ts', 'whatever'), // file does not exist → deleted
            ],
            edges: [],
        };
        const result = computeStatus(indexGraph(graph), { repoDir: dir });

        expect(result.fresh).toBe(1);
        expect(result.stale).toEqual(['changed.ts']);
        expect(result.deleted).toEqual(['gone.ts']);
        expect(result.up_to_date).toBe(false);
    });

    it('reports up_to_date when every known file still matches', () => {
        const graph: GraphData = { nodes: [node('fresh.ts', freshHash)], edges: [] };
        const result = computeStatus(indexGraph(graph), { repoDir: dir });
        expect(result.up_to_date).toBe(true);
        expect(result.fresh).toBe(1);
    });

    it('flags files stored without a hash as unknown, not fresh', () => {
        const graph: GraphData = { nodes: [node('fresh.ts')], edges: [] };
        const result = computeStatus(indexGraph(graph), { repoDir: dir });
        expect(result.unknown).toEqual(['fresh.ts']);
        expect(result.fresh).toBe(0);
    });
});
