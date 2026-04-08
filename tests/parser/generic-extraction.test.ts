import { describe, expect, test } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawGraph } from '../../src/graph/types';
import { extractGeneric } from '../../src/parser/extractors/generic';
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
// Go
// ---------------------------------------------------------------------------

describe('extractGeneric – Go', () => {
    test('extracts struct UserService as class from sample.go', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('type_declaration');
    });

    test('extracts Logger interface from sample.go', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const logger = graph.interfaces.find((i) => i.name === 'Logger');
        expect(logger).toBeDefined();
        expect(logger!.ast_kind).toBe('type_declaration');
    });

    test('extracts functions from sample.go', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        expect(graph.functions.some((f) => f.name === 'NewUserService')).toBe(true);
        const newUserService = graph.functions.find((f) => f.name === 'NewUserService');
        expect(newUserService).toBeDefined();
        expect(newUserService!.ast_kind).toBe('function_declaration');

        expect(graph.functions.some((f) => f.name === 'GetName')).toBe(true);
        const getName = graph.functions.find((f) => f.name === 'GetName');
        expect(getName).toBeDefined();
        expect(getName!.ast_kind).toBe('method_declaration');

        expect(graph.functions.some((f) => f.name === 'handleRequest')).toBe(true);
    });

    test('extracts imports from sample.go', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts test functions from sample_test.go', async () => {
        const fp = join(FIXTURES, 'go/sample_test.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const testFunc = graph.tests.find((t) => t.name === 'TestNewUserService');
        expect(testFunc).toBeDefined();

        const benchFunc = graph.tests.find((t) => t.name === 'BenchmarkGetName');
        expect(benchFunc).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

describe('extractGeneric – Java', () => {
    test('extracts UserService class with extends from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'java', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('class_declaration');
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('Greetable');
    });

    test('extracts Greetable interface from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'java', new Set(), graph);

        const greetable = graph.interfaces.find((i) => i.name === 'Greetable');
        expect(greetable).toBeDefined();
        expect(greetable!.ast_kind).toBe('interface_declaration');
    });

    test('extracts Status enum from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'java', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('enum_declaration');
    });

    test('extracts imports from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'java', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts @Test annotated test methods from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'java', new Set(), graph);

        expect(graph.tests.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

describe('extractGeneric – Rust', () => {
    test('extracts UserService struct as class from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('struct_item');
    });

    test('extracts Greetable trait as interface from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const greetable = graph.interfaces.find((i) => i.name === 'Greetable');
        expect(greetable).toBeDefined();
        expect(greetable!.ast_kind).toBe('trait_item');
    });

    test('extracts Status enum from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('enum_item');
    });

    test('extracts functions from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        expect(graph.functions.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts imports from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts #[test] functions from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const testFunc = graph.tests.find((t) => t.name === 'test_new_user_service');
        expect(testFunc).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

describe('extractGeneric – C#', () => {
    test('extracts UserService class with heritage from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'csharp', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('class_declaration');
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('IGreetable');
    });

    test('extracts IGreetable interface from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'csharp', new Set(), graph);

        const iGreetable = graph.interfaces.find((i) => i.name === 'IGreetable');
        expect(iGreetable).toBeDefined();
        expect(iGreetable!.ast_kind).toBe('interface_declaration');
    });

    test('extracts Status enum from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'csharp', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('enum_declaration');
    });

    test('extracts using directives as imports from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'csharp', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts [Fact] annotated test methods from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'csharp', new Set(), graph);

        expect(graph.tests.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

describe('extractGeneric – PHP', () => {
    test('extracts UserService class with heritage from Sample.php', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'php', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('class_declaration');
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('Greetable');
    });

    test('extracts Loggable interface from Sample.php', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'php', new Set(), graph);

        expect(graph.interfaces.length).toBeGreaterThanOrEqual(1);
        const loggable = graph.interfaces.find((i) => i.name === 'Loggable');
        expect(loggable).toBeDefined();
    });

    test('extracts standalone helperFunction from Sample.php', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'php', new Set(), graph);

        expect(graph.functions.some((f) => f.name === 'helperFunction')).toBe(true);
    });

    test('extracts use statements as imports from Sample.php', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'php', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('testGetName is extracted as a test (func matches ^test pattern)', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'php', new Set(), graph);

        // PHP test detection uses OR: funcPattern (^test) matches testGetName even
        // though the file does not match Test.php$, so testGetName is in tests.
        expect(graph.tests.length).toBeGreaterThanOrEqual(1);
        const testGetName = graph.tests.find((t) => t.name === 'testGetName');
        expect(testGetName).toBeDefined();
        // It is also still present in functions (tests are dual-listed)
        expect(graph.functions.some((f) => f.name === 'testGetName')).toBe(true);
    });
});
