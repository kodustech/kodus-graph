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

    test('method with pointer receiver has className set', async () => {
        const code =
            'package main\ntype UserService struct{}\nfunc (s *UserService) GetUser(id int) error { return nil }';
        const fp = 'file.go';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'GetUser');
        expect(getUser).toBeDefined();
        expect(getUser!.className).toBe('UserService');
        expect(getUser!.qualified).toBe('file.go::UserService.GetUser');
        expect(getUser!.kind).toBe('Method');
    });

    test('method with value receiver has className set', async () => {
        const code =
            'package main\ntype UserService struct{}\nfunc (s UserService) GetName() string { return s.Name }';
        const fp = 'file.go';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const getName = graph.functions.find((f) => f.name === 'GetName');
        expect(getName).toBeDefined();
        expect(getName!.className).toBe('UserService');
        expect(getName!.qualified).toBe('file.go::UserService.GetName');
        expect(getName!.kind).toBe('Method');
    });

    test('standalone function has no className', async () => {
        const code = 'package main\nfunc NewService() *Service { return nil }';
        const fp = 'file.go';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const newService = graph.functions.find((f) => f.name === 'NewService');
        expect(newService).toBeDefined();
        expect(newService!.className).toBe('');
        expect(newService!.kind).toBe('Function');
    });

    test('struct embedding sets extends', async () => {
        const code =
            'package main\ntype Base struct{ Name string }\ntype Admin struct{ Base\n AdminLevel int }';
        const fp = 'file.go';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const admin = graph.classes.find((c) => c.name === 'Admin');
        expect(admin).toBeDefined();
        expect(admin!.extends).toBe('Base');

        // Base struct has no embedding, so extends should be empty
        const base = graph.classes.find((c) => c.name === 'Base');
        expect(base).toBeDefined();
        expect(base!.extends).toBe('');
    });

    test('existing sample.go GetName method has className = UserService', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'go', new Set(), graph);

        const getName = graph.functions.find((f) => f.name === 'GetName');
        expect(getName).toBeDefined();
        expect(getName!.className).toBe('UserService');
        expect(getName!.kind).toBe('Method');
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

    test('impl block methods have className set to struct name', async () => {
        const code =
            'pub struct User { name: String }\nimpl User { pub fn new(name: String) -> Self { Self { name } } fn validate(&self) -> bool { true } }';
        const fp = 'file.rs';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const newFn = graph.functions.find((f) => f.name === 'new');
        expect(newFn).toBeDefined();
        expect(newFn!.className).toBe('User');
        expect(newFn!.qualified).toBe('file.rs::User.new');
        expect(newFn!.kind).toBe('Method');

        const validateFn = graph.functions.find((f) => f.name === 'validate');
        expect(validateFn).toBeDefined();
        expect(validateFn!.className).toBe('User');
        expect(validateFn!.qualified).toBe('file.rs::User.validate');
        expect(validateFn!.kind).toBe('Method');
    });

    test('impl_item does NOT create a class node', async () => {
        const code = 'pub struct User {}\nimpl User { fn new() -> Self { Self {} } }';
        const fp = 'file.rs';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        // Only 1 class node (User struct), NOT 2
        expect(graph.classes.length).toBe(1);
        expect(graph.classes[0].name).toBe('User');
        expect(graph.classes[0].ast_kind).toBe('struct_item');
    });

    test('impl Trait for Struct adds trait to implements', async () => {
        const code =
            'pub struct Repo {}\npub trait Repository { fn find(&self); }\nimpl Repository for Repo { fn find(&self) {} }';
        const fp = 'file.rs';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const repo = graph.classes.find((c) => c.name === 'Repo');
        expect(repo).toBeDefined();
        expect(repo!.implements).toContain('Repository');
    });

    test('impl Display for UserService adds Display to implements (sample.rs)', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.implements).toContain('fmt::Display');
    });

    test('standalone functions (not in impl) have no className', async () => {
        const code = 'fn main() { println!("hello"); }';
        const fp = 'file.rs';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const mainFn = graph.functions.find((f) => f.name === 'main');
        expect(mainFn).toBeDefined();
        expect(mainFn!.className).toBe('');
        expect(mainFn!.kind).toBe('Function');
    });

    test('sample.rs methods inside impl have className = UserService', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'rust', new Set(), graph);

        const newFn = graph.functions.find((f) => f.name === 'new');
        expect(newFn).toBeDefined();
        expect(newFn!.className).toBe('UserService');
        expect(newFn!.kind).toBe('Method');
        expect(newFn!.qualified).toBe(`${fp}::UserService.new`);

        const getNameFn = graph.functions.find((f) => f.name === 'get_name');
        expect(getNameFn).toBeDefined();
        expect(getNameFn!.className).toBe('UserService');
        expect(getNameFn!.kind).toBe('Method');
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

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------

describe('extractGeneric – Kotlin', () => {
    test('extracts UserService class with extends from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('class_declaration');
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('Greetable');
    });

    test('extracts BaseService class from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const baseService = graph.classes.find((c) => c.name === 'BaseService');
        expect(baseService).toBeDefined();
        expect(baseService!.ast_kind).toBe('class_declaration');
    });

    test('extracts data class UserDto from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const userDto = graph.classes.find((c) => c.name === 'UserDto');
        expect(userDto).toBeDefined();
        expect(userDto!.ast_kind).toBe('class_declaration');
    });

    test('extracts object declaration SingletonHelper as class from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const singleton = graph.classes.find((c) => c.name === 'SingletonHelper');
        expect(singleton).toBeDefined();
        expect(singleton!.ast_kind).toBe('object_declaration');
    });

    test('extracts Greetable interface from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const greetable = graph.interfaces.find((i) => i.name === 'Greetable');
        expect(greetable).toBeDefined();
        expect(greetable!.ast_kind).toBe('class_declaration');
    });

    test('extracts Status enum from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('class_declaration');
    });

    test('extracts functions from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        expect(graph.functions.some((f) => f.name === 'getName')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'createUser')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'greet')).toBe(true);
    });

    test('methods inside class have className set', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const getName = graph.functions.find((f) => f.name === 'getName');
        expect(getName).toBeDefined();
        expect(getName!.className).toBe('UserService');
        expect(getName!.kind).toBe('Method');
    });

    test('standalone function has no className', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        const testGetName = graph.functions.find((f) => f.name === 'testGetName');
        expect(testGetName).toBeDefined();
        expect(testGetName!.className).toBe('');
        expect(testGetName!.kind).toBe('Function');
    });

    test('extracts imports from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(2);
        expect(graph.imports.some((i) => i.module === 'com.example.models.User')).toBe(true);
    });

    test('extracts @Test annotated function as test from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractGeneric(root, fp, 'kotlin', new Set(), graph);

        expect(graph.tests.length).toBeGreaterThanOrEqual(1);
        const testFunc = graph.tests.find((t) => t.name === 'testGetName');
        expect(testFunc).toBeDefined();
    });
});
