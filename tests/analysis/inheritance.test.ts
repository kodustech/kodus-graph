import { describe, expect, it } from 'bun:test';
import { extractInheritance } from '../../src/analysis/inheritance';
import { indexGraph } from '../../src/graph/loader';
import type { GraphData } from '../../src/graph/types';

describe('extractInheritance', () => {
    it('should extract extends, implements, and children for classes in changed files', () => {
        const data: GraphData = {
            nodes: [
                {
                    kind: 'Class',
                    name: 'AuthService',
                    qualified_name: 'src/auth.ts::AuthService',
                    file_path: 'src/auth.ts',
                    line_start: 1,
                    line_end: 50,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
                {
                    kind: 'Interface',
                    name: 'IAuth',
                    qualified_name: 'src/types.ts::IAuth',
                    file_path: 'src/types.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'b',
                },
                {
                    kind: 'Class',
                    name: 'BaseService',
                    qualified_name: 'src/base.ts::BaseService',
                    file_path: 'src/base.ts',
                    line_start: 1,
                    line_end: 30,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'c',
                },
                {
                    kind: 'Class',
                    name: 'OAuth2Service',
                    qualified_name: 'src/oauth.ts::OAuth2Service',
                    file_path: 'src/oauth.ts',
                    line_start: 1,
                    line_end: 40,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'd',
                },
            ],
            edges: [
                {
                    kind: 'INHERITS',
                    source_qualified: 'src/auth.ts::AuthService',
                    target_qualified: 'src/base.ts::BaseService',
                    file_path: 'src/auth.ts',
                    line: 1,
                },
                {
                    kind: 'IMPLEMENTS',
                    source_qualified: 'src/auth.ts::AuthService',
                    target_qualified: 'src/types.ts::IAuth',
                    file_path: 'src/auth.ts',
                    line: 1,
                },
                {
                    kind: 'INHERITS',
                    source_qualified: 'src/oauth.ts::OAuth2Service',
                    target_qualified: 'src/auth.ts::AuthService',
                    file_path: 'src/oauth.ts',
                    line: 1,
                },
            ],
        };

        const indexed = indexGraph(data);
        const result = extractInheritance(indexed, ['src/auth.ts']);

        expect(result).toHaveLength(1);
        expect(result[0].qualified_name).toBe('src/auth.ts::AuthService');
        expect(result[0].extends).toBe('src/base.ts::BaseService');
        expect(result[0].implements).toEqual(['src/types.ts::IAuth']);
        expect(result[0].children).toEqual(['src/oauth.ts::OAuth2Service']);
    });

    it('should return empty array when no classes in changed files', () => {
        const data: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'foo',
                    qualified_name: 'src/a.ts::foo',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [],
        };

        const indexed = indexGraph(data);
        const result = extractInheritance(indexed, ['src/a.ts']);
        expect(result).toEqual([]);
    });
});
