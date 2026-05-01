import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../src/graph/types';
import { extractAll, extractCallsFromEngine, hasExtractor, registerExtractor } from '../../src/languages/engine';
import type { LanguageKey } from '../../src/languages/language-of-file';
import { emptyResult } from '../../src/languages/shared';
import type { ExtractionResult, LanguageExtractors } from '../../src/languages/spec';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyGraph(): RawGraph {
    return {
        functions: [],
        classes: [],
        interfaces: [],
        enums: [],
        tests: [],
        imports: [],
        reExports: [],
        rawCalls: [],
        diMaps: new Map(),

        valueBindings: new Map(),
    };
}

/**
 * Minimal mock SgRoot whose `.root()` returns whatever SgNode we hand it.
 * The engine calls `root.root()` then passes the SgNode to the extractor,
 * so the node itself is opaque to the engine — the mock extractor ignores it.
 */
function mockSgRoot(): { root(): SgNode } {
    return { root: () => ({}) as SgNode };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractor engine — registry', () => {
    it('hasExtractor returns false for unregistered language', () => {
        expect(hasExtractor('__unregistered_lang__')).toBe(false);
    });

    it('registerExtractor makes hasExtractor return true', () => {
        // Synthetic lang key — test-only escape hatch to avoid polluting the
        // real LanguageKey union with dummy values. Real registrations in src/
        // are typo-proof because they accept LanguageKey directly.
        const lang = '__test_register__' as LanguageKey;
        const stub: LanguageExtractors = {
            extract: () => emptyResult(),
            extractCalls: () => {},
        };
        registerExtractor(lang, stub);
        expect(hasExtractor(lang)).toBe(true);
    });
});

describe('extractor engine — extractAll', () => {
    it('pushes classes to graph with correct qualified name and dedup key', () => {
        const lang = '__test_classes__' as LanguageKey;
        const result: ExtractionResult = {
            ...emptyResult(),
            classes: [
                {
                    name: 'UserService',
                    line_start: 5,
                    line_end: 50,
                    extends: 'BaseService',
                    implements: ['IService'],
                    modifiers: 'public',
                    ast_kind: 'class_declaration',
                    content_hash: 'abc123',
                    is_exported: false,
                    decorators: [],
                },
            ],
        };
        registerExtractor(lang, {
            extract: () => result,
            extractCalls: () => {},
        });

        const graph = emptyGraph();
        const seen = new Set<string>();
        extractAll(mockSgRoot() as any, 'src/service.ts', lang, seen, graph);

        expect(graph.classes).toHaveLength(1);
        expect(graph.classes[0].name).toBe('UserService');
        expect(graph.classes[0].file).toBe('src/service.ts');
        expect(graph.classes[0].qualified).toBe('src/service.ts::UserService');
        expect(graph.classes[0].extends).toBe('BaseService');
        expect(graph.classes[0].implements).toEqual(['IService']);
        expect(graph.classes[0].modifiers).toBe('public');
        expect(graph.classes[0].content_hash).toBe('abc123');

        // Dedup: calling again should not add a second entry
        extractAll(mockSgRoot() as any, 'src/service.ts', lang, seen, graph);
        expect(graph.classes).toHaveLength(1);
    });

    it('pushes functions to graph and marks tests', () => {
        const lang = '__test_functions__' as LanguageKey;
        const result: ExtractionResult = {
            ...emptyResult(),
            functions: [
                {
                    name: 'handleRequest',
                    line_start: 10,
                    line_end: 30,
                    params: '(req: Request)',
                    returnType: 'Response',
                    kind: 'Method',
                    className: 'Controller',
                    modifiers: '',
                    ast_kind: 'method_definition',
                    content_hash: 'def456',
                    isTest: false,
                    is_exported: false,
                    is_async: false,
                    decorators: [],
                    throws: [],
                    complexity: 1,
                },
                {
                    name: 'TestGetUser',
                    line_start: 40,
                    line_end: 55,
                    params: '(t *testing.T)',
                    returnType: '',
                    kind: 'Function',
                    className: '',
                    modifiers: '',
                    ast_kind: 'function_declaration',
                    content_hash: 'test789',
                    isTest: true,
                    is_exported: false,
                    is_async: false,
                    decorators: [],
                    throws: [],
                    complexity: 1,
                },
            ],
        };
        registerExtractor(lang, {
            extract: () => result,
            extractCalls: () => {},
        });

        const graph = emptyGraph();
        const seen = new Set<string>();
        extractAll(mockSgRoot() as any, 'src/controller.go', lang, seen, graph);

        expect(graph.functions).toHaveLength(2);

        const method = graph.functions.find((f) => f.name === 'handleRequest');
        expect(method).toBeDefined();
        expect(method!.qualified).toBe('src/controller.go::Controller.handleRequest');
        expect(method!.kind).toBe('Method');

        const testFn = graph.functions.find((f) => f.name === 'TestGetUser');
        expect(testFn).toBeDefined();
        expect(testFn!.qualified).toBe('src/controller.go::TestGetUser');

        // Test functions should also appear in graph.tests
        expect(graph.tests).toHaveLength(1);
        expect(graph.tests[0].name).toBe('TestGetUser');
        expect(graph.tests[0].qualified).toBe('src/controller.go::TestGetUser');
    });

    it('pushes imports, re-exports, interfaces, enums, and DI entries', () => {
        const lang = '__test_full__' as LanguageKey;
        const result: ExtractionResult = {
            classes: [],
            functions: [],
            imports: [{ module: './utils', line: 1, names: ['helper'], lang: 'ts' }],
            reExports: [{ module: './models', line: 2 }],
            interfaces: [
                {
                    name: 'IRepo',
                    line_start: 5,
                    line_end: 15,
                    methods: ['findById', 'save'],
                    ast_kind: 'interface_declaration',
                    content_hash: 'iface001',
                    is_exported: false,
                },
            ],
            enums: [
                {
                    name: 'Status',
                    line_start: 20,
                    line_end: 25,
                    ast_kind: 'enum_declaration',
                    content_hash: 'enum001',
                    is_exported: false,
                },
            ],
            diEntries: [{ fieldName: 'repo', typeName: 'UserRepository' }],
        };
        registerExtractor(lang, {
            extract: () => result,
            extractCalls: () => {},
        });

        const graph = emptyGraph();
        const seen = new Set<string>();
        extractAll(mockSgRoot() as any, 'src/app.ts', lang, seen, graph);

        // Imports
        expect(graph.imports).toHaveLength(1);
        expect(graph.imports[0].module).toBe('./utils');
        expect(graph.imports[0].file).toBe('src/app.ts');

        // Re-exports
        expect(graph.reExports).toHaveLength(1);
        expect(graph.reExports[0].module).toBe('./models');

        // Interfaces
        expect(graph.interfaces).toHaveLength(1);
        expect(graph.interfaces[0].qualified).toBe('src/app.ts::IRepo');
        expect(graph.interfaces[0].methods).toEqual(['findById', 'save']);

        // Enums
        expect(graph.enums).toHaveLength(1);
        expect(graph.enums[0].qualified).toBe('src/app.ts::Status');

        // DI maps
        expect(graph.diMaps.has('src/app.ts')).toBe(true);
        expect(graph.diMaps.get('src/app.ts')!.get('repo')).toBe('UserRepository');
    });

    it('does nothing for unregistered language', () => {
        const graph = emptyGraph();
        const seen = new Set<string>();
        extractAll(mockSgRoot() as any, 'src/main.zig', '__no_such_lang__', seen, graph);

        expect(graph.functions).toHaveLength(0);
        expect(graph.classes).toHaveLength(0);
    });
});

describe('extractor engine — extractCallsFromEngine', () => {
    it('delegates call extraction to registered extractor', () => {
        const lang = '__test_calls__' as LanguageKey;
        const captured: RawCallSite[] = [];

        registerExtractor(lang, {
            extract: () => emptyResult(),
            extractCalls: (_root, fp, calls) => {
                calls.push({
                    source: fp,
                    callName: 'doStuff',
                    line: 42,
                });
            },
        });

        extractCallsFromEngine(mockSgRoot() as any, 'src/handler.rs', lang, captured);

        expect(captured).toHaveLength(1);
        expect(captured[0].callName).toBe('doStuff');
        expect(captured[0].source).toBe('src/handler.rs');
        expect(captured[0].line).toBe(42);
    });

    it('does nothing for unregistered language', () => {
        const calls: RawCallSite[] = [];
        extractCallsFromEngine(mockSgRoot() as any, 'src/main.zig', '__no_calls_lang__', calls);
        expect(calls).toHaveLength(0);
    });
});
