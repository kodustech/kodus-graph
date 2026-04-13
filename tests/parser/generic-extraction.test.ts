import { describe, expect, test } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
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
// Go
// ---------------------------------------------------------------------------

describe('extractGeneric – Go', () => {
    test('extracts struct UserService as class from sample.go', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'go', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('type_declaration');
    });

    test('extracts Logger interface from sample.go', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'go', new Set(), graph);

        const logger = graph.interfaces.find((i) => i.name === 'Logger');
        expect(logger).toBeDefined();
        expect(logger!.ast_kind).toBe('type_declaration');
    });

    test('extracts functions from sample.go', async () => {
        const fp = join(FIXTURES, 'go/sample.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'go', new Set(), graph);

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
        extractFromFile(root, fp, 'go', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts test functions from sample_test.go', async () => {
        const fp = join(FIXTURES, 'go/sample_test.go');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'go', new Set(), graph);

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
        extractFromFile(root, fp, 'go', new Set(), graph);

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
        extractFromFile(root, fp, 'go', new Set(), graph);

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
        extractFromFile(root, fp, 'go', new Set(), graph);

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
        extractFromFile(root, fp, 'go', new Set(), graph);

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
        extractFromFile(root, fp, 'go', new Set(), graph);

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
        extractFromFile(root, fp, 'java', new Set(), graph);

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
        extractFromFile(root, fp, 'java', new Set(), graph);

        const greetable = graph.interfaces.find((i) => i.name === 'Greetable');
        expect(greetable).toBeDefined();
        expect(greetable!.ast_kind).toBe('interface_declaration');
    });

    test('extracts Status enum from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('enum_declaration');
    });

    test('extracts imports from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts @Test annotated test methods from Sample.java', async () => {
        const fp = join(FIXTURES, 'java/Sample.java');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        expect(graph.tests.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts class annotations in modifiers (marker_annotation)', async () => {
        const code = '@Service\npublic class UserService { }';
        const fp = 'Test.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.modifiers).toBeDefined();
        expect(cls!.modifiers).toContain('@Service');
        expect(cls!.modifiers).toContain('public');
    });

    test('extracts method annotations in modifiers (marker_annotation and annotation)', async () => {
        const code = [
            'public class Ctrl {',
            '    @Override',
            '    public void run() {}',
            '    @GetMapping("/users")',
            '    public void getUsers() {}',
            '}',
        ].join('\n');
        const fp = 'Test.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const runFn = graph.functions.find((f) => f.name === 'run');
        expect(runFn).toBeDefined();
        expect(runFn!.modifiers).toContain('@Override');
        expect(runFn!.modifiers).toContain('public');

        const getUsersFn = graph.functions.find((f) => f.name === 'getUsers');
        expect(getUsersFn).toBeDefined();
        expect(getUsersFn!.modifiers).toContain('@GetMapping("/users")');
        expect(getUsersFn!.modifiers).toContain('public');
    });

    test('extracts multiple annotations on a class', async () => {
        const code = '@Service\n@Transactional\npublic class OrderService { }';
        const fp = 'Test.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'OrderService');
        expect(cls).toBeDefined();
        expect(cls!.modifiers).toContain('@Service');
        expect(cls!.modifiers).toContain('@Transactional');
    });

    test('constructor modifiers include annotations', async () => {
        const code = [
            'public class Svc {',
            '    @Autowired',
            '    public Svc(Repo repo) {}',
            '}',
        ].join('\n');
        const fp = 'Test.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const ctor = graph.functions.find((f) => f.kind === 'Constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.modifiers).toContain('@Autowired');
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
        extractFromFile(root, fp, 'rust', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('struct_item');
    });

    test('extracts Greetable trait as interface from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

        const greetable = graph.interfaces.find((i) => i.name === 'Greetable');
        expect(greetable).toBeDefined();
        expect(greetable!.ast_kind).toBe('trait_item');
    });

    test('extracts Status enum from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('enum_item');
    });

    test('extracts functions from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

        expect(graph.functions.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts imports from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts #[test] functions from sample.rs', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

        const testFunc = graph.tests.find((t) => t.name === 'test_new_user_service');
        expect(testFunc).toBeDefined();
    });

    test('impl block methods have className set to struct name', async () => {
        const code =
            'pub struct User { name: String }\nimpl User { pub fn new(name: String) -> Self { Self { name } } fn validate(&self) -> bool { true } }';
        const fp = 'file.rs';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

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
        extractFromFile(root, fp, 'rust', new Set(), graph);

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
        extractFromFile(root, fp, 'rust', new Set(), graph);

        const repo = graph.classes.find((c) => c.name === 'Repo');
        expect(repo).toBeDefined();
        expect(repo!.implements).toContain('Repository');
    });

    test('impl Display for UserService adds Display to implements (sample.rs)', async () => {
        const fp = join(FIXTURES, 'rust/sample.rs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.implements).toContain('fmt::Display');
    });

    test('standalone functions (not in impl) have no className', async () => {
        const code = 'fn main() { println!("hello"); }';
        const fp = 'file.rs';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'rust', new Set(), graph);

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
        extractFromFile(root, fp, 'rust', new Set(), graph);

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
        extractFromFile(root, fp, 'csharp', new Set(), graph);

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
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const iGreetable = graph.interfaces.find((i) => i.name === 'IGreetable');
        expect(iGreetable).toBeDefined();
        expect(iGreetable!.ast_kind).toBe('interface_declaration');
    });

    test('extracts Status enum from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('enum_declaration');
    });

    test('extracts using directives as imports from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts [Fact] annotated test methods from Sample.cs', async () => {
        const fp = join(FIXTURES, 'csharp/Sample.cs');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

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
        extractFromFile(root, fp, 'php', new Set(), graph);

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
        extractFromFile(root, fp, 'php', new Set(), graph);

        expect(graph.interfaces.length).toBeGreaterThanOrEqual(1);
        const loggable = graph.interfaces.find((i) => i.name === 'Loggable');
        expect(loggable).toBeDefined();
    });

    test('extracts standalone helperFunction from Sample.php', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        expect(graph.functions.some((f) => f.name === 'helperFunction')).toBe(true);
    });

    test('extracts use statements as imports from Sample.php', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(1);
    });

    test('testGetName is extracted as a test (func matches ^test pattern)', async () => {
        const fp = join(FIXTURES, 'php/Sample.php');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        // PHP test detection uses OR: funcPattern (^test) matches testGetName even
        // though the file does not match Test.php$, so testGetName is in tests.
        expect(graph.tests.length).toBeGreaterThanOrEqual(1);
        const testGetName = graph.tests.find((t) => t.name === 'testGetName');
        expect(testGetName).toBeDefined();
        // It is also still present in functions (tests are dual-listed)
        expect(graph.functions.some((f) => f.name === 'testGetName')).toBe(true);
    });

    test('extracts extends from qualified_name (namespaced parent)', async () => {
        const code = '<?php class Admin extends App\\Models\\User { }';
        const fp = 'test.php';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        const admin = graph.classes.find((c) => c.name === 'Admin');
        expect(admin).toBeDefined();
        expect(admin!.extends).toBe('App\\Models\\User');
    });

    test('extracts implements from qualified_name (namespaced interfaces)', async () => {
        const code = '<?php class Svc implements App\\Contracts\\Loggable, App\\Contracts\\Greetable { }';
        const fp = 'test.php';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        const svc = graph.classes.find((c) => c.name === 'Svc');
        expect(svc).toBeDefined();
        expect(svc!.implements).toContain('App\\Contracts\\Loggable');
        expect(svc!.implements).toContain('App\\Contracts\\Greetable');
    });

    test('extracts simple extends and implements together', async () => {
        const code = '<?php class Admin extends User implements Serializable, JsonSerializable { }';
        const fp = 'test.php';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        const admin = graph.classes.find((c) => c.name === 'Admin');
        expect(admin).toBeDefined();
        expect(admin!.extends).toBe('User');
        expect(admin!.implements).toContain('Serializable');
        expect(admin!.implements).toContain('JsonSerializable');
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
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

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
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const baseService = graph.classes.find((c) => c.name === 'BaseService');
        expect(baseService).toBeDefined();
        expect(baseService!.ast_kind).toBe('class_declaration');
    });

    test('extracts data class UserDto from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const userDto = graph.classes.find((c) => c.name === 'UserDto');
        expect(userDto).toBeDefined();
        expect(userDto!.ast_kind).toBe('class_declaration');
    });

    test('extracts object declaration SingletonHelper as class from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const singleton = graph.classes.find((c) => c.name === 'SingletonHelper');
        expect(singleton).toBeDefined();
        expect(singleton!.ast_kind).toBe('object_declaration');
    });

    test('extracts Greetable interface from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const greetable = graph.interfaces.find((i) => i.name === 'Greetable');
        expect(greetable).toBeDefined();
        expect(greetable!.ast_kind).toBe('class_declaration');
    });

    test('extracts Status enum from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'Status');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('class_declaration');
    });

    test('extracts functions from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        expect(graph.functions.some((f) => f.name === 'getName')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'createUser')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'greet')).toBe(true);
    });

    test('methods inside class have className set', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

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
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

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
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(2);
        expect(graph.imports.some((i) => i.module === 'com.example.models.User')).toBe(true);
    });

    test('extracts @Test annotated function as test from Sample.kt', async () => {
        const fp = join(FIXTURES, 'kotlin/Sample.kt');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        expect(graph.tests.length).toBeGreaterThanOrEqual(1);
        const testFunc = graph.tests.find((t) => t.name === 'testGetName');
        expect(testFunc).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// New field extraction tests: is_exported, is_async, decorators, throws
// ---------------------------------------------------------------------------

describe('new fields – Go', () => {
    test('exported function (uppercase) has is_exported=true', async () => {
        const code = 'package main\nfunc GetUser() {}';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.go', 'go', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'GetUser');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('private function (lowercase) has is_exported=false', async () => {
        const code = 'package main\nfunc getUser() {}';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.go', 'go', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUser');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('exported struct has is_exported=true', async () => {
        const code = 'package main\ntype UserService struct{}';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.go', 'go', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('private struct has is_exported=false', async () => {
        const code = 'package main\ntype userService struct{}';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.go', 'go', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'userService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBeFalsy();
    });

    test('Go functions have is_async=false (no async in Go)', async () => {
        const code = 'package main\nfunc GetUser() {}';
        const root = await parseAsync('go', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.go', 'go', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'GetUser');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBeFalsy();
    });
});

describe('new fields – Java', () => {
    test('public class has is_exported=true', async () => {
        const code = 'public class UserService { }';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.java', 'java', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('package-private class has is_exported=false', async () => {
        const code = 'class InternalService { }';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.java', 'java', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'InternalService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBeFalsy();
    });

    test('annotated class has decorators populated', async () => {
        const code = '@Service\npublic class UserService { }';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.java', 'java', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.decorators).toBeDefined();
        expect(cls!.decorators!.some((d) => d.includes('@Service'))).toBe(true);
    });

    test('method with throws clause has throws populated', async () => {
        const code = [
            'public class Svc {',
            '    public void process() throws IOException, ParseException { }',
            '}',
        ].join('\n');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.java', 'java', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'process');
        expect(fn).toBeDefined();
        expect(fn!.throws).toBeDefined();
        expect(fn!.throws).toContain('IOException');
        expect(fn!.throws).toContain('ParseException');
    });

    test('public method has is_exported=true', async () => {
        const code = 'public class Svc { public void run() {} }';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.java', 'java', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'run');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('private method has is_exported=false', async () => {
        const code = 'public class Svc { private void helper() {} }';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.java', 'java', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('method with annotation has decorators populated', async () => {
        const code = [
            'public class Ctrl {',
            '    @GetMapping("/users")',
            '    public void getUsers() {}',
            '}',
        ].join('\n');
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.java', 'java', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUsers');
        expect(fn).toBeDefined();
        expect(fn!.decorators).toBeDefined();
        expect(fn!.decorators!.some((d) => d.includes('@GetMapping'))).toBe(true);
    });
});

describe('new fields – Rust', () => {
    test('pub function has is_exported=true', async () => {
        const code = 'pub fn get_user() {}';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rs', 'rust', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'get_user');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('non-pub function has is_exported=false', async () => {
        const code = 'fn helper() {}';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rs', 'rust', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('pub struct has is_exported=true', async () => {
        const code = 'pub struct User { name: String }';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rs', 'rust', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'User');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('async fn has is_async=true', async () => {
        const code = 'async fn fetch_data() {}';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rs', 'rust', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fetch_data');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBe(true);
    });

    test('#[derive(Debug)] attribute is captured in decorators', async () => {
        const code = '#[derive(Debug)]\npub struct User {}';
        const root = await parseAsync('rust', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rs', 'rust', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'User');
        expect(cls).toBeDefined();
        expect(cls!.decorators).toBeDefined();
        expect(cls!.decorators!.some((d) => d.includes('derive(Debug)'))).toBe(true);
    });
});

describe('new fields – C#', () => {
    test('public class has is_exported=true', async () => {
        const code = 'public class UserService { }';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.cs', 'csharp', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('internal class has is_exported=false', async () => {
        const code = 'internal class InternalService { }';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.cs', 'csharp', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'InternalService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBeFalsy();
    });

    test('async method has is_async=true', async () => {
        const code = [
            'public class Svc {',
            '    public async Task RunAsync() { }',
            '}',
        ].join('\n');
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.cs', 'csharp', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'RunAsync');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBe(true);
    });
});

describe('new fields – Kotlin', () => {
    test('public class (default) has is_exported=true', async () => {
        const code = 'class UserService { }';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.kt', 'kotlin', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('public function (default) has is_exported=true', async () => {
        const code = 'fun getUser() { }';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.kt', 'kotlin', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUser');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });
});

describe('new fields – PHP', () => {
    test('PHP class is exported by default', async () => {
        const code = '<?php class UserService { }';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.php', 'php', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('PHP public method is exported', async () => {
        const code = '<?php class Svc { public function run() {} }';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.php', 'php', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'run');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('PHP private method is not exported', async () => {
        const code = '<?php class Svc { private function helper() {} }';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.php', 'php', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });
});

describe('new fields – TypeScript', () => {
    test('exported function has is_exported=true', async () => {
        const code = 'export function fetchUser() {}';
        const root = await parseAsync(Lang.TypeScript, code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.ts', Lang.TypeScript, new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fetchUser');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('non-exported function has is_exported=false', async () => {
        const code = 'function helper() {}';
        const root = await parseAsync(Lang.TypeScript, code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.ts', Lang.TypeScript, new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('async function has is_async=true', async () => {
        const code = 'export async function fetchUser() {}';
        const root = await parseAsync(Lang.TypeScript, code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.ts', Lang.TypeScript, new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fetchUser');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBe(true);
    });

    test('non-async function has is_async=false', async () => {
        const code = 'export function syncFunc() {}';
        const root = await parseAsync(Lang.TypeScript, code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.ts', Lang.TypeScript, new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'syncFunc');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBeFalsy();
    });

    test('exported class has is_exported=true', async () => {
        const code = 'export class UserService {}';
        const root = await parseAsync(Lang.TypeScript, code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.ts', Lang.TypeScript, new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });
});

describe('new fields – Python', () => {
    test('public function (no underscore) has is_exported=true', async () => {
        const code = 'def get_user():\n    pass';
        const root = await parseAsync('python', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.py', 'python', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'get_user');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('private function (underscore prefix) has is_exported=false', async () => {
        const code = 'def _helper():\n    pass';
        const root = await parseAsync('python', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.py', 'python', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === '_helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('public class (no underscore) has is_exported=true', async () => {
        const code = 'class UserService:\n    pass';
        const root = await parseAsync('python', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.py', 'python', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });
});

describe('new fields – Ruby', () => {
    test('Ruby method is exported by default', async () => {
        const code = 'class Svc\n  def run\n  end\nend';
        const root = await parseAsync('ruby', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rb', 'ruby', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'run');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('Ruby class is exported by default', async () => {
        const code = 'class UserService\nend';
        const root = await parseAsync('ruby', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rb', 'ruby', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('Ruby has is_async=false (no async in Ruby)', async () => {
        const code = 'def run\nend';
        const root = await parseAsync('ruby', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.rb', 'ruby', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'run');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBeFalsy();
    });
});
