import { describe, expect, it } from 'bun:test';
import { unresolvedImportCheck } from '../../src/analysis/import-resolution';
import type { GraphNode } from '../../src/graph/types';

function node(qualified_name: string): GraphNode {
    return {
        kind: 'Function',
        name: qualified_name.split('::').pop() ?? qualified_name,
        qualified_name,
        file_path: qualified_name.split('::')[0],
        line_start: 0,
        line_end: 1,
        language: 'typescript',
        is_test: false,
    };
}

describe('unresolvedImportCheck', () => {
    const isUnresolved = unresolvedImportCheck([node('src/a.ts::helper'), node('src/b.ts::Outer::inner')]);

    it('does not flag a target in a file that was not parsed', () => {
        expect(isUnresolved('src/elsewhere.ts::thing')).toBe(false);
    });

    it('does not flag a target that is a node', () => {
        expect(isUnresolved('src/a.ts::helper')).toBe(false);
    });

    it('does not flag a target that declares nodes under it', () => {
        expect(isUnresolved('src/b.ts')).toBe(false);
        expect(isUnresolved('src/b.ts::Outer')).toBe(false);
    });

    it('flags a target in a parsed file that declares nothing by that name', () => {
        expect(isUnresolved('src/a.ts::missing')).toBe(true);
        expect(isUnresolved('src/b.ts::Out')).toBe(true);
    });
});
