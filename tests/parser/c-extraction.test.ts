import { describe, expect, test } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawGraph } from '../../src/graph/types';
import { extractFromFile } from '../../src/parser/extractor';
import '../../src/parser/languages'; // trigger registration

const FIXTURES = join(import.meta.dir, '../fixtures');

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
    };
}

// ---------------------------------------------------------------------------
// C
// ---------------------------------------------------------------------------

describe('C extractor – sample.c', () => {
    test('extracts typedef struct User as class', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const user = graph.classes.find((c) => c.name === 'User');
        expect(user).toBeDefined();
        expect(user!.ast_kind).toBe('type_definition');
        expect(user!.modifiers).toBe('typedef');
    });

    test('extracts standalone struct Point as class', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const point = graph.classes.find((c) => c.name === 'Point');
        expect(point).toBeDefined();
        expect(point!.ast_kind).toBe('struct_specifier');
    });

    test('extracts enum Status', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const status = graph.enums.find((e) => e.name === 'Status');
        expect(status).toBeDefined();
        expect(status!.ast_kind).toBe('enum_specifier');
    });

    test('extracts functions', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const processUser = graph.functions.find((f) => f.name === 'process_user');
        expect(processUser).toBeDefined();
        expect(processUser!.kind).toBe('Function');

        const helper = graph.functions.find((f) => f.name === 'helper');
        expect(helper).toBeDefined();
        expect(helper!.modifiers).toBe('static');

        const add = graph.functions.find((f) => f.name === 'add');
        expect(add).toBeDefined();
    });

    test('static functions are NOT exported', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const helper = graph.functions.find((f) => f.name === 'helper');
        expect(helper).toBeDefined();
        expect(helper!.is_exported).toBeFalsy();
    });

    test('functions in .c files are not exported by default', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const processUser = graph.functions.find((f) => f.name === 'process_user');
        expect(processUser).toBeDefined();
        expect(processUser!.is_exported).toBeFalsy();
    });

    test('extracts #include imports', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(3);

        const stdio = graph.imports.find((i) => i.module === 'stdio.h');
        expect(stdio).toBeDefined();
        expect(stdio!.lang).toBe('c');

        const utils = graph.imports.find((i) => i.module === 'utils.h');
        expect(utils).toBeDefined();
    });

    test('is_async is always false for C', async () => {
        const fp = join(FIXTURES, 'c/sample.c');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        for (const f of graph.functions) {
            expect(f.is_async).toBeFalsy();
        }
    });
});

describe('C extractor – sample.h (header file)', () => {
    test('functions in header files are exported', async () => {
        const fp = join(FIXTURES, 'c/sample.h');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const widget = graph.classes.find((c) => c.name === 'Widget');
        expect(widget).toBeDefined();
        expect(widget!.is_exported).toBe(true);

        const color = graph.enums.find((e) => e.name === 'Color');
        expect(color).toBeDefined();
        expect(color!.is_exported).toBe(true);
    });

    test('extracts local include from header', async () => {
        const fp = join(FIXTURES, 'c/sample.h');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('c', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'c', new Set(), graph);

        const typesInc = graph.imports.find((i) => i.module === 'types.h');
        expect(typesInc).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// C++
// ---------------------------------------------------------------------------

describe('C++ extractor – sample.cpp', () => {
    test('extracts class UserService with heritage', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('class_specifier');
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('IRepository');
    });

    test('extracts template class Container', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const container = graph.classes.find((c) => c.name === 'Container');
        expect(container).toBeDefined();
        expect(container!.modifiers).toBe('template');
    });

    test('extracts struct Point', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const point = graph.classes.find((c) => c.name === 'Point');
        expect(point).toBeDefined();
        expect(point!.ast_kind).toBe('struct_specifier');
    });

    test('extracts enum class Direction', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const direction = graph.enums.find((e) => e.name === 'Direction');
        expect(direction).toBeDefined();
    });

    test('extracts C++ methods with correct className', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.kind).toBe('Method');
        expect(getUser!.className).toBe('UserService');

        const validate = graph.functions.find((f) => f.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate!.kind).toBe('Method');
        expect(validate!.className).toBe('UserService');
    });

    test('extracts constructor', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const ctor = graph.functions.find((f) => f.name === 'UserService' && f.kind === 'Constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.className).toBe('UserService');
    });

    test('public methods are exported, private methods are not', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.is_exported).toBe(true);

        const validate = graph.functions.find((f) => f.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate!.is_exported).toBeFalsy();
    });

    test('static functions are not exported', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const internalHelper = graph.functions.find((f) => f.name === 'internal_helper');
        expect(internalHelper).toBeDefined();
        expect(internalHelper!.is_exported).toBeFalsy();
        expect(internalHelper!.modifiers).toBe('static');
    });

    test('free function outside class is a Function (not Method)', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const standalone = graph.functions.find((f) => f.name === 'standalone_function');
        expect(standalone).toBeDefined();
        expect(standalone!.kind).toBe('Function');
        expect(standalone!.className).toBe('');
    });

    test('extracts #include imports for C++', async () => {
        const fp = join(FIXTURES, 'cpp/sample.cpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(3);

        const stringInc = graph.imports.find((i) => i.module === 'string');
        expect(stringInc).toBeDefined();
        expect(stringInc!.lang).toBe('cpp');

        const userInc = graph.imports.find((i) => i.module === 'models/user.h');
        expect(userInc).toBeDefined();
    });
});

describe('C++ extractor – sample.hpp (header file)', () => {
    test('classes in header files are exported', async () => {
        const fp = join(FIXTURES, 'cpp/sample.hpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const shape = graph.classes.find((c) => c.name === 'Shape');
        expect(shape).toBeDefined();
        expect(shape!.is_exported).toBe(true);

        const circle = graph.classes.find((c) => c.name === 'Circle');
        expect(circle).toBeDefined();
        expect(circle!.is_exported).toBe(true);
        expect(circle!.extends).toBe('Shape');
    });

    test('struct Config in header is exported', async () => {
        const fp = join(FIXTURES, 'cpp/sample.hpp');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('cpp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'cpp', new Set(), graph);

        const config = graph.classes.find((c) => c.name === 'Config');
        expect(config).toBeDefined();
        expect(config!.is_exported).toBe(true);
        expect(config!.ast_kind).toBe('struct_specifier');
    });
});
