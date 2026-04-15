import { describe, expect, it } from 'bun:test';
import { graphDataSchema, graphEdgeSchema, graphNodeSchema } from '../../src/shared/schemas';

const baseMetadata = {
    repo_dir: '/tmp/repo',
    files_parsed: 1,
    total_nodes: 1,
    total_edges: 0,
    duration_ms: 42,
    parse_errors: 0,
    extract_errors: 0,
};

describe('Graph schema validation', () => {
    it('validates a minimal valid graph', () => {
        const graph = {
            metadata: baseMetadata,
            nodes: [
                {
                    kind: 'Function',
                    name: 'foo',
                    qualified_name: 'file.ts::foo',
                    file_path: 'file.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [],
        };
        expect(() => graphDataSchema.parse(graph)).not.toThrow();
    });

    it('validates new fields: is_exported, is_async, decorators, throws', () => {
        const node = {
            kind: 'Function',
            name: 'fetchUser',
            qualified_name: 'src/api.ts::fetchUser',
            file_path: 'src/api.ts',
            line_start: 10,
            line_end: 20,
            language: 'typescript',
            is_test: false,
            is_exported: true,
            is_async: true,
            decorators: ['@Injectable()'],
            throws: ['NotFoundError'],
        };
        expect(() => graphNodeSchema.parse(node)).not.toThrow();

        const parsed = graphNodeSchema.parse(node);
        expect(parsed.is_exported).toBe(true);
        expect(parsed.is_async).toBe(true);
        expect(parsed.decorators).toEqual(['@Injectable()']);
        expect(parsed.throws).toEqual(['NotFoundError']);
    });

    it('rejects invalid edge kind', () => {
        const edge = {
            kind: 'INVALID_KIND',
            source_qualified: 'a',
            target_qualified: 'b',
            file_path: 'f',
            line: 1,
        };
        expect(() => graphEdgeSchema.parse(edge)).toThrow();
    });

    it('rejects invalid node kind', () => {
        const node = {
            kind: 'NotARealKind',
            name: 'x',
            qualified_name: 'x',
            file_path: 'x',
            line_start: 1,
            line_end: 1,
            language: 'typescript',
            is_test: false,
        };
        expect(() => graphNodeSchema.parse(node)).toThrow();
    });

    it('accepts missing optional new fields (backward compat)', () => {
        // Old graphs without is_exported etc. should still validate.
        const node = {
            kind: 'Function',
            name: 'foo',
            qualified_name: 'f::foo',
            file_path: 'f',
            line_start: 1,
            line_end: 1,
            language: 'go',
            is_test: false,
            // No is_exported, is_async, decorators, throws
        };
        expect(() => graphNodeSchema.parse(node)).not.toThrow();
    });

    it('rejects wrong type for is_exported', () => {
        const node = {
            kind: 'Function',
            name: 'foo',
            qualified_name: 'f::foo',
            file_path: 'f',
            line_start: 1,
            line_end: 1,
            language: 'typescript',
            is_test: false,
            is_exported: 'yes', // should be boolean
        };
        expect(() => graphNodeSchema.parse(node)).toThrow();
    });

    it('rejects wrong element type in decorators/throws', () => {
        const node = {
            kind: 'Function',
            name: 'foo',
            qualified_name: 'f::foo',
            file_path: 'f',
            line_start: 1,
            line_end: 1,
            language: 'typescript',
            is_test: false,
            decorators: [123], // should be string
        };
        expect(() => graphNodeSchema.parse(node)).toThrow();

        const node2 = {
            kind: 'Function',
            name: 'foo',
            qualified_name: 'f::foo',
            file_path: 'f',
            line_start: 1,
            line_end: 1,
            language: 'typescript',
            is_test: false,
            throws: [{ x: 1 }], // should be string
        };
        expect(() => graphNodeSchema.parse(node2)).toThrow();
    });

    it('accepts all valid edge kinds', () => {
        const kinds = ['CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS', 'TESTED_BY', 'CONTAINS'];
        for (const kind of kinds) {
            const edge = {
                kind,
                source_qualified: 'a',
                target_qualified: 'b',
                file_path: 'f',
                line: 1,
            };
            expect(() => graphEdgeSchema.parse(edge)).not.toThrow();
        }
    });

    it('accepts all valid node kinds', () => {
        const kinds = ['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Enum', 'Test'];
        for (const kind of kinds) {
            const node = {
                kind,
                name: 'x',
                qualified_name: 'x',
                file_path: 'x',
                line_start: 1,
                line_end: 1,
                language: 'typescript',
                is_test: false,
            };
            expect(() => graphNodeSchema.parse(node)).not.toThrow();
        }
    });

    it('rejects graph missing metadata', () => {
        const graph = {
            nodes: [],
            edges: [],
        };
        expect(() => graphDataSchema.parse(graph)).toThrow();
    });
});
