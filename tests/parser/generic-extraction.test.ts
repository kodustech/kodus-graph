import { describe, expect, test } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawCallSite, RawGraph } from '../../src/graph/types';
import { extractCallsFromFile, extractFromFile } from '../../src/parser/extractor';
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

        valueBindings: new Map(),
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
        const code = 'package main\ntype UserService struct{}\nfunc (s UserService) GetName() string { return s.Name }';
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
        const code = 'package main\ntype Base struct{ Name string }\ntype Admin struct{ Base\n AdminLevel int }';
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
        const code = ['public class Svc {', '    @Autowired', '    public Svc(Repo repo) {}', '}'].join('\n');
        const fp = 'Test.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const ctor = graph.functions.find((f) => f.kind === 'Constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.modifiers).toContain('@Autowired');
    });

    test('Java field → diMap covers BOTH annotated and bare typed fields', async () => {
        // Behavior change 2026-04-30: bare typed fields (no annotation) also
        // populate diMap so `this.other.foo()` resolves at the receiver tier.
        // Catches Lombok @RequiredArgsConstructor and manual ctor injection
        // patterns where fields aren't individually annotated. Annotated
        // fields still work the same way.
        const code = [
            'public class UserService {',
            '    @Inject',
            '    private UserRepository repo;',
            '    @Autowired',
            '    private final Logger logger;',
            '    @jakarta.inject.Inject',
            '    private NotifierService notifier;',
            '    private final BareTypedField bare;',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
        expect(diMap!.get('notifier')).toBe('NotifierService');
        // `bare` is NOT annotated but its type is known — bound for receiver-tier use.
        expect(diMap!.get('bare')).toBe('BareTypedField');
    });

    test('@Inject on constructor adds every parameter to diMap', async () => {
        const code = [
            'public class UserService {',
            '    private final UserRepository repo;',
            '    private final Logger logger;',
            '    @Autowired',
            '    public UserService(UserRepository repo, Logger logger) {',
            '        this.repo = repo;',
            '        this.logger = logger;',
            '    }',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
    });

    test('Spring @Service + single ctor implicitly injects all params (Spring 4.3+)', async () => {
        const code = [
            '@Service',
            'public class UserService {',
            '    private final UserRepository repo;',
            '    private final Logger logger;',
            '    public UserService(UserRepository repo, Logger logger) {',
            '        this.repo = repo;',
            '        this.logger = logger;',
            '    }',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
    });

    test('Spring @RestController + single ctor implicitly injects all params', async () => {
        const code = [
            '@RestController',
            'public class UserController {',
            '    public UserController(UserService svc) { this.svc = svc; }',
            '}',
        ].join('\n');
        const fp = '/virt/UserController.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('svc')).toBe('UserService');
    });

    test('Spring @Component with two ctors does NOT trigger implicit DI', async () => {
        const code = [
            '@Component',
            'public class Svc {',
            '    public Svc(Repo repo) {}',
            '    public Svc(Repo repo, Logger logger) {}',
            '}',
        ].join('\n');
        const fp = '/virt/Svc.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        // No DI: ambiguous — Spring requires exactly one ctor for implicit injection.
        expect(diMap?.get('repo')).toBeUndefined();
        expect(diMap?.get('logger')).toBeUndefined();
    });

    test('Plain class with single ctor and no stereotype produces no DI', async () => {
        const code = ['public class PlainBean {', '    public PlainBean(Repo repo, Logger logger) {}', '}'].join('\n');
        const fp = '/virt/PlainBean.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap?.get('repo')).toBeUndefined();
        expect(diMap?.get('logger')).toBeUndefined();
    });

    test('CDI @ApplicationScoped + single ctor implicitly injects params', async () => {
        const code = [
            '@ApplicationScoped',
            'public class UserService {',
            '    public UserService(UserRepository repo) {}',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);
        expect(graph.diMaps.get(fp)?.get('repo')).toBe('UserRepository');
    });

    test('EJB @Stateless + single ctor implicitly injects params', async () => {
        const code = ['@Stateless', 'public class Svc {', '    public Svc(Repo repo) {}', '}'].join('\n');
        const fp = '/virt/Svc.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);
        expect(graph.diMaps.get(fp)?.get('repo')).toBe('Repo');
    });

    test('JAX-RS @Path + single ctor implicitly injects params', async () => {
        const code = [
            '@Path("/users")',
            'public class UserResource {',
            '    public UserResource(UserService svc) {}',
            '}',
        ].join('\n');
        const fp = '/virt/UserResource.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);
        expect(graph.diMaps.get(fp)?.get('svc')).toBe('UserService');
    });

    test('Spring @Service + explicit @Autowired ctor still extracts DI', async () => {
        const code = [
            '@Service',
            'public class UserService {',
            '    @Autowired',
            '    public UserService(UserRepository repo) {}',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
    });

    test('this.field.method() call sets diField for resolver routing', async () => {
        const code = [
            'public class Svc {',
            '    @Inject',
            '    private Repo repo;',
            '    public void run() {',
            '        this.repo.find();',
            '    }',
            '}',
        ].join('\n');
        const fp = '/virt/Svc.java';
        const root = await parseAsync('java', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'java', new Set(), graph);
        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'java', calls);

        const findCall = calls.find((c) => c.callName === 'find');
        expect(findCall).toBeDefined();
        expect(findCall!.diField).toBe('repo');
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

    test('typed instance field → diMap (mirrors .NET ctor-assigned field pattern)', async () => {
        const code = [
            'public class UserService {',
            '    private readonly IUserRepository _repo;',
            '    private readonly ILogger _logger;',
            '    public UserService(IUserRepository repo, ILogger logger) {',
            '        _repo = repo;',
            '        _logger = logger;',
            '    }',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.cs';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('_repo')).toBe('IUserRepository');
        expect(diMap!.get('_logger')).toBe('ILogger');
        expect(diMap!.get('repo')).toBe('IUserRepository');
        expect(diMap!.get('logger')).toBe('ILogger');
    });

    test('[Inject] property (Blazor) → diMap', async () => {
        const code = [
            'public class UserPage {',
            '    [Inject]',
            '    public IUserRepository Repo { get; set; }',
            '}',
        ].join('\n');
        const fp = '/virt/UserPage.cs';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('Repo')).toBe('IUserRepository');
    });

    test('primary constructor on class (C# 12+) → diMap', async () => {
        const code = [
            'public class UserService(IUserRepository repo, ILogger logger) {',
            '    public void Run() => repo.FindAll();',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.cs';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('IUserRepository');
        expect(diMap!.get('logger')).toBe('ILogger');
    });

    test('record primary constructor → diMap', async () => {
        const code = [
            'public record UserService(IUserRepository Repo, ILogger Logger) {',
            '    public void Run() => Repo.FindAll();',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.cs';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('Repo')).toBe('IUserRepository');
        expect(diMap!.get('Logger')).toBe('ILogger');
    });

    test('class with two ctors → no implicit ctor injection (only field injection)', async () => {
        // Two ctors → ambiguous which one is the DI ctor; .NET requires a
        // single ctor (or [ActivatorUtilitiesConstructor]). We mirror that
        // by NOT auto-injecting params when count != 1. Fields still go in.
        const code = [
            'public class UserService {',
            '    private readonly IUserRepository _repo;',
            '    public UserService() { }',
            '    public UserService(IUserRepository repo, ILogger logger) {',
            '        _repo = repo;',
            '    }',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.cs';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('_repo')).toBe('IUserRepository');
        // ctor params NOT injected because there are two ctors
        expect(diMap!.get('logger')).toBeUndefined();
    });

    test('predefined types (int/string) excluded from primary-ctor diMap', async () => {
        const code = ['public record Point(int X, int Y);'].join('\n');
        const fp = '/virt/Point.cs';
        const root = await parseAsync('csharp', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'csharp', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        // diMap may exist for fields but should not contain int/string params
        expect(diMap?.get('X')).toBeUndefined();
        expect(diMap?.get('Y')).toBeUndefined();
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

    test('typed property `private Foo $repo;` populates diMap', async () => {
        const code = [
            '<?php',
            'class UserService {',
            '    private UserRepository $repo;',
            '    private Logger $logger;',
            '    private $untyped;',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.php';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
        expect(diMap!.has('untyped')).toBe(false);
    });

    test('PHP 8 promoted constructor properties populate diMap', async () => {
        const code = [
            '<?php',
            'class UserService {',
            '    public function __construct(',
            '        private UserRepository $repo,',
            '        public Logger $logger,',
            '        $plain,',
            '    ) {}',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.php';
        const root = await parseAsync('php', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'php', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
        expect(diMap!.has('plain')).toBe(false);
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

    test('Kotlin primary ctor `val`/`var` params → diMap (idiomatic Kotlin)', async () => {
        // The dominant Kotlin DI pattern: plain class with val/var primary
        // ctor params, no annotation. Captures Koin and manual ctor injection.
        const code = [
            'class UserService(val repo: UserRepository, var logger: Logger) {',
            '    fun list() = repo.findAll()',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
    });

    test('Kotlin primary ctor params WITHOUT val/var are NOT diMap entries', async () => {
        // `class Foo(repo: Repo)` — repo is ctor-local, not a property. Adding
        // it to diMap would let unrelated method-body resolution incorrectly
        // pick it up; we explicitly skip such params.
        const code = ['class UserService(repo: UserRepository) {', '    private val r = repo', '}'].join('\n');
        const fp = '/virt/UserService.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap?.get('repo')).toBeUndefined();
    });

    test('Spring @Service on Kotlin class → primary ctor params injected', async () => {
        // Kotlin reuses Java's Spring stereotypes verbatim. The class-level
        // annotation gates `@Service` + single primary ctor → all params
        // become diMap entries (independent of val/var, by stereotype rule).
        const code = [
            '@Service',
            'class UserService(private val repo: UserRepository, val logger: Logger) {',
            '    fun list() = repo.findAll()',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
    });

    test('Hilt @HiltViewModel on Kotlin class → primary ctor injected', async () => {
        const code = [
            '@HiltViewModel',
            'class UserVM @Inject constructor(val repo: UserRepository) {',
            '    fun load() = repo.findAll()',
            '}',
        ].join('\n');
        const fp = '/virt/UserVM.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
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
        const code = ['public class Ctrl {', '    @GetMapping("/users")', '    public void getUsers() {}', '}'].join(
            '\n',
        );
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
        const code = ['public class Svc {', '    public async Task RunAsync() { }', '}'].join('\n');
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

    test('@Inject on property populates diMap', async () => {
        const code = [
            'class UserService {',
            '    @Inject',
            '    lateinit var repo: UserRepository',
            '    @javax.inject.Inject',
            '    lateinit var logger: Logger',
            '    var notInjected: NotInjected? = null',
            '}',
        ].join('\n');
        const fp = '/virt/UserService.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
        expect(diMap!.has('notInjected')).toBe(false);
    });

    test('@Inject on primary constructor adds every class_parameter to diMap', async () => {
        const code = [
            'class UserService @Inject constructor(',
            '    private val repo: UserRepository,',
            '    private val logger: Logger,',
            ') { }',
        ].join('\n');
        const fp = '/virt/UserService.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('repo')).toBe('UserRepository');
        expect(diMap!.get('logger')).toBe('Logger');
    });

    test('primary constructor val/var params populate diMap (idiomatic Kotlin)', async () => {
        // Behavior change: bare `val`/`var` primary ctor params populate
        // diMap even without `@Inject`, mirroring Java's bare-typed-fields
        // decision. Catches Koin and manual ctor injection where annotations
        // aren't present. Params WITHOUT val/var stay excluded (test below).
        const code = ['class OtherService(private val plain: NotInjected) { }'].join('\n');
        const fp = '/virt/OtherService.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap).toBeDefined();
        expect(diMap!.get('plain')).toBe('NotInjected');
    });

    test('primary constructor params without val/var stay out of diMap', async () => {
        // `class Foo(plain: NotInjected)` — `plain` is ctor-local, not a
        // property. We deliberately skip these to avoid false positives
        // when method bodies reference unrelated names that happen to match.
        const code = ['class OtherService(plain: NotInjected) { }'].join('\n');
        const fp = '/virt/OtherService.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);

        const diMap = graph.diMaps.get(fp);
        expect(diMap?.get('plain')).toBeUndefined();
    });

    test('field.method() and this.field.method() set diField', async () => {
        const code = [
            'class Svc @Inject constructor(private val repo: Repo) {',
            '    fun a() { repo.find() }',
            '    fun b() { this.repo.find() }',
            '}',
        ].join('\n');
        const fp = '/virt/Svc.kt';
        const root = await parseAsync('kotlin', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'kotlin', new Set(), graph);
        const calls: RawCallSite[] = [];
        extractCallsFromFile(root, fp, 'kotlin', calls);

        const findCalls = calls.filter((c) => c.callName === 'find');
        expect(findCalls.length).toBe(2);
        for (const c of findCalls) {
            expect(c.diField).toBe('repo');
        }
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

describe('Python re-exports (__init__.py barrel pattern)', () => {
    test('relative `from .x import y` in __init__.py produces a re-export entry', async () => {
        const code = 'from .auth import authenticate\nfrom .db import query';
        const root = await parseAsync('python', code);
        const graph = emptyGraph();
        extractFromFile(root, 'utils/__init__.py', 'python', new Set(), graph);

        expect(graph.reExports).toHaveLength(2);
        expect(graph.reExports[0]).toMatchObject({ module: '.auth', file: 'utils/__init__.py' });
        expect(graph.reExports[1]).toMatchObject({ module: '.db', file: 'utils/__init__.py' });
    });

    test('relative imports in non-__init__ files do NOT become re-exports', async () => {
        const code = 'from .auth import authenticate';
        const root = await parseAsync('python', code);
        const graph = emptyGraph();
        extractFromFile(root, 'utils/api.py', 'python', new Set(), graph);

        expect(graph.reExports).toHaveLength(0);
        // Still extracted as a regular import.
        expect(graph.imports.find((i) => i.module === '.auth')).toBeDefined();
    });

    test('absolute imports in __init__.py are NOT re-exports (sibling deps, not flow-through)', async () => {
        const code = 'from typing import List\nimport os';
        const root = await parseAsync('python', code);
        const graph = emptyGraph();
        extractFromFile(root, 'pkg/__init__.py', 'python', new Set(), graph);

        expect(graph.reExports).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// Swift
// ---------------------------------------------------------------------------

describe('extractGeneric – Swift', () => {
    test('extracts UserService class with extends and implements from Sample.swift', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('class_declaration');
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('Repository');
    });

    test('extracts struct UserDTO as class from Sample.swift', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const userDto = graph.classes.find((c) => c.name === 'UserDTO');
        expect(userDto).toBeDefined();
        expect(userDto!.ast_kind).toBe('class_declaration');
    });

    test('extracts Repository protocol as interface from Sample.swift', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const repo = graph.interfaces.find((i) => i.name === 'Repository');
        expect(repo).toBeDefined();
        expect(repo!.ast_kind).toBe('protocol_declaration');
        expect(repo!.methods).toContain('find');
        expect(repo!.methods).toContain('save');
    });

    test('extracts UserStatus enum from Sample.swift', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const statusEnum = graph.enums.find((e) => e.name === 'UserStatus');
        expect(statusEnum).toBeDefined();
        expect(statusEnum!.ast_kind).toBe('class_declaration');
    });

    test('extracts functions from Sample.swift', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        expect(graph.functions.some((f) => f.name === 'getUser')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'validate')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'createService')).toBe(true);
    });

    test('extracts init as Constructor from Sample.swift', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const initFunc = graph.functions.find((f) => f.name === 'init');
        expect(initFunc).toBeDefined();
        expect(initFunc!.kind).toBe('Constructor');
        expect(initFunc!.className).toBe('UserService');
        expect(initFunc!.ast_kind).toBe('init_declaration');
    });

    test('methods inside class have className set', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.className).toBe('UserService');
        expect(getUser!.kind).toBe('Method');
    });

    test('standalone function has no className', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const createService = graph.functions.find((f) => f.name === 'createService');
        expect(createService).toBeDefined();
        expect(createService!.className).toBe('');
        expect(createService!.kind).toBe('Function');
    });

    test('extracts imports from Sample.swift', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(2);
        expect(graph.imports.some((i) => i.module === 'Foundation')).toBe(true);
        expect(graph.imports.some((i) => i.module === 'UIKit')).toBe(true);
    });

    test('detects async function', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.is_async).toBe(true);

        const validate = graph.functions.find((f) => f.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate!.is_async).toBeFalsy();
    });

    test('detects throws in function', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.throws).toContain('throws');
    });

    test('detects is_exported for public/open declarations', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        // UserService is open → exported
        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.is_exported).toBe(true);

        // getUser is public → exported
        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.is_exported).toBe(true);

        // validate is internal → not exported
        const validate = graph.functions.find((f) => f.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate!.is_exported).toBeFalsy();

        // createService has no modifier → internal by default → not exported
        const createService = graph.functions.find((f) => f.name === 'createService');
        expect(createService).toBeDefined();
        expect(createService!.is_exported).toBeFalsy();
    });

    test('extracts decorators/attributes', async () => {
        const fp = join(FIXTURES, 'swift/Sample.swift');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'swift', new Set(), graph);

        // UserService has @objc
        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.decorators).toBeDefined();
        expect(userService!.decorators!.some((d) => d.includes('@objc'))).toBe(true);

        // getUser has @discardableResult
        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.decorators).toBeDefined();
        expect(getUser!.decorators!.some((d) => d.includes('@discardableResult'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Dart
// ---------------------------------------------------------------------------

describe('extractGeneric – Dart', () => {
    test('extracts class UserService from Sample.dart', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('class_definition');
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('Repository');
    });

    test('extracts abstract class Repository as interface', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        const repo = graph.interfaces.find((i) => i.name === 'Repository');
        expect(repo).toBeDefined();
        expect(repo!.ast_kind).toBe('class_definition');
        expect(repo!.methods).toContain('find');
        expect(repo!.methods).toContain('save');
    });

    test('extracts enum UserStatus', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        const userStatus = graph.enums.find((e) => e.name === 'UserStatus');
        expect(userStatus).toBeDefined();
        expect(userStatus!.ast_kind).toBe('enum_declaration');
    });

    test('extracts mixin Loggable as class', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        const loggable = graph.classes.find((c) => c.name === 'Loggable');
        expect(loggable).toBeDefined();
        expect(loggable!.ast_kind).toBe('mixin_declaration');
        expect(loggable!.modifiers).toContain('mixin');
    });

    test('extracts methods from UserService', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        // find method (with @override)
        const findMethod = graph.functions.find((f) => f.name === 'find' && f.className === 'UserService');
        expect(findMethod).toBeDefined();
        expect(findMethod!.kind).toBe('Method');
        expect(findMethod!.is_async).toBe(true);
        expect(findMethod!.decorators).toContain('@override');

        // _validate method (with @protected, private name)
        const validate = graph.functions.find((f) => f.name === '_validate');
        expect(validate).toBeDefined();
        expect(validate!.kind).toBe('Method');
        expect(validate!.is_exported).toBeFalsy();
        expect(validate!.decorators).toContain('@protected');
    });

    test('extracts constructor from UserService', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        const ctor = graph.functions.find((f) => f.name === 'UserService' && f.kind === 'Constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.className).toBe('UserService');
    });

    test('extracts top-level function createService', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        const createService = graph.functions.find((f) => f.name === 'createService');
        expect(createService).toBeDefined();
        expect(createService!.kind).toBe('Function');
        expect(createService!.is_async).toBe(true);
        expect(createService!.className).toBe('');
    });

    test('extracts imports from Sample.dart', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(4);
        const modules = graph.imports.map((i) => i.module);
        expect(modules).toContain('dart:async');
        expect(modules).toContain('package:flutter/material.dart');
        expect(modules).toContain('package:my_app/models/user.dart');
        expect(modules).toContain('../relative.dart');
    });

    test('export detection: underscore prefix = private', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        // UserService is public (no underscore)
        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService!.is_exported).toBe(true);

        // _validate starts with underscore → private
        const validate = graph.functions.find((f) => f.name === '_validate');
        expect(validate!.is_exported).toBeFalsy();

        // find is public
        const findMethod = graph.functions.find((f) => f.name === 'find' && f.className === 'UserService');
        expect(findMethod!.is_exported).toBe(true);

        // createService is public
        const createService = graph.functions.find((f) => f.name === 'createService');
        expect(createService!.is_exported).toBe(true);
    });

    test('throws is always empty/undefined for Dart', async () => {
        const fp = join(FIXTURES, 'dart/sample.dart');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'dart', new Set(), graph);

        for (const fn of graph.functions) {
            // Dart has no throws clause; engine converts empty array to undefined
            expect(fn.throws ?? []).toEqual([]);
        }
    });
});

// ---------------------------------------------------------------------------
// Scala
// ---------------------------------------------------------------------------

describe('extractGeneric – Scala', () => {
    test('extracts UserService class with extends and implements from Sample.scala', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'UserService' && c.ast_kind === 'class_definition');
        expect(userService).toBeDefined();
        expect(userService!.extends).toBe('BaseService');
        expect(userService!.implements).toContain('Repository');
        expect(userService!.implements).toContain('Serializable');
    });

    test('extracts case class UserDTO as class from Sample.scala', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const userDto = graph.classes.find((c) => c.name === 'UserDTO');
        expect(userDto).toBeDefined();
        expect(userDto!.ast_kind).toBe('class_definition');
    });

    test('extracts Repository trait as interface from Sample.scala', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const repo = graph.interfaces.find((i) => i.name === 'Repository');
        expect(repo).toBeDefined();
        expect(repo!.ast_kind).toBe('trait_definition');
        expect(repo!.methods).toContain('find');
        expect(repo!.methods).toContain('save');
    });

    test('extracts sealed trait Status as interface from Sample.scala', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const status = graph.interfaces.find((i) => i.name === 'Status');
        expect(status).toBeDefined();
        expect(status!.ast_kind).toBe('trait_definition');
    });

    test('extracts object as class (companion object deduped with class)', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        // Scala companion objects share the same name as their class.
        // The engine deduplicates by name, so only the class_definition is kept.
        // Verify the class_definition UserService is present.
        const userService = graph.classes.find((c) => c.name === 'UserService');
        expect(userService).toBeDefined();

        // Verify case objects (Active, Inactive) which have unique names are extracted
        const active = graph.classes.find((c) => c.name === 'Active');
        expect(active).toBeDefined();
        expect(active!.ast_kind).toBe('object_definition');
    });

    test('extracts case objects Active and Inactive as classes from Sample.scala', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const active = graph.classes.find((c) => c.name === 'Active');
        expect(active).toBeDefined();
        expect(active!.ast_kind).toBe('object_definition');
        expect(active!.extends).toBe('Status');

        const inactive = graph.classes.find((c) => c.name === 'Inactive');
        expect(inactive).toBeDefined();
        expect(inactive!.extends).toBe('Status');
    });

    test('extracts methods from Sample.scala', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        expect(graph.functions.some((f) => f.name === 'create')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'find')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'validate')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'getUser')).toBe(true);
    });

    test('methods inside class have className set', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.className).toBe('UserService');
        expect(getUser!.kind).toBe('Method');
    });

    test('private method is not exported', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const validate = graph.functions.find((f) => f.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate!.is_exported).toBeFalsy();
    });

    test('public method is exported by default', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        const getUser = graph.functions.find((f) => f.name === 'getUser');
        expect(getUser).toBeDefined();
        expect(getUser!.is_exported).toBe(true);
    });

    test('extracts imports from Sample.scala', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        expect(graph.imports.length).toBeGreaterThanOrEqual(2);
        expect(graph.imports.some((i) => i.module === 'com.example.models.User')).toBe(true);
        expect(graph.imports.some((i) => i.module === 'com.example.services._')).toBe(true);
    });

    test('is_async is always false for Scala (uses Futures, no async keyword)', async () => {
        const fp = join(FIXTURES, 'scala/Sample.scala');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'scala', new Set(), graph);

        for (const fn of graph.functions) {
            expect(fn.is_async).toBeFalsy();
        }
    });
});

describe('new fields – Swift', () => {
    test('public func has is_exported=true', async () => {
        const code = 'public func getUser() {}';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUser');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('open class has is_exported=true', async () => {
        const code = 'open class UserService {}';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('private func has is_exported=false', async () => {
        const code = 'private func helper() {}';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('async func has is_async=true', async () => {
        const code = 'public func fetchData() async -> String { return "" }';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fetchData');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBe(true);
    });

    test('non-async func has is_async=false', async () => {
        const code = 'public func syncFunc() {}';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'syncFunc');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBeFalsy();
    });

    test('@objc attribute is captured in decorators', async () => {
        const code = '@objc\nopen class UserService {}';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.decorators).toBeDefined();
        expect(cls!.decorators!.some((d) => d.includes('@objc'))).toBe(true);
    });

    test('@discardableResult attribute is captured in decorators', async () => {
        const code = '@discardableResult\npublic func getUser() -> Int { return 0 }';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUser');
        expect(fn).toBeDefined();
        expect(fn!.decorators).toBeDefined();
        expect(fn!.decorators!.some((d) => d.includes('@discardableResult'))).toBe(true);
    });

    test('throws keyword is captured in throws', async () => {
        const code = 'public func getUser() throws -> String { return "" }';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUser');
        expect(fn).toBeDefined();
        expect(fn!.throws).toBeDefined();
        expect(fn!.throws).toContain('throws');
    });

    test('non-throwing func has empty throws', async () => {
        const code = 'public func noThrow() {}';
        const root = await parseAsync('swift', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.swift', 'swift', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'noThrow');
        expect(fn).toBeDefined();
        expect(fn!.throws ?? []).toEqual([]);
    });
});

describe('new fields – Dart', () => {
    test('name without underscore prefix has is_exported=true', async () => {
        const code = 'void getUser() {}';
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.dart', 'dart', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUser');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('name with underscore prefix has is_exported=false', async () => {
        const code = 'void _helper() {}';
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.dart', 'dart', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === '_helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('public class has is_exported=true', async () => {
        const code = 'class UserService {}';
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.dart', 'dart', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'UserService');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('async function has is_async=true', async () => {
        const code = 'Future<void> fetchData() async { return; }';
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.dart', 'dart', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fetchData');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBe(true);
    });

    test('@override decorator is captured', async () => {
        const code = ['class Svc {', '  @override', '  void run() {}', '}'].join('\n');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.dart', 'dart', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'run');
        expect(fn).toBeDefined();
        expect(fn!.decorators).toBeDefined();
        expect(fn!.decorators).toContain('@override');
    });

    test('@protected decorator is captured', async () => {
        const code = ['class Svc {', '  @protected', '  void _validate() {}', '}'].join('\n');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.dart', 'dart', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === '_validate');
        expect(fn).toBeDefined();
        expect(fn!.decorators).toBeDefined();
        expect(fn!.decorators).toContain('@protected');
    });

    test('Dart has no throws concept — throws is always empty', async () => {
        const code = ['void fail() {', '  throw ArgumentError("x");', '}'].join('\n');
        const root = await parseAsync('dart', code);
        const graph = emptyGraph();
        extractFromFile(root, 'file.dart', 'dart', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fail');
        expect(fn).toBeDefined();
        expect(fn!.throws ?? []).toEqual([]);
    });
});

describe('new fields – Scala', () => {
    test('public method (default, no modifier) has is_exported=true', async () => {
        const code = 'class Svc { def getUser(): String = "x" }';
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.scala', 'scala', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'getUser');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('private method has is_exported=false', async () => {
        const code = 'class Svc { private def helper(): Unit = () }';
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.scala', 'scala', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'helper');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('protected method has is_exported=false', async () => {
        const code = 'class Svc { protected def guarded(): Unit = () }';
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.scala', 'scala', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'guarded');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('is_async is always false for Scala (uses Futures, no async keyword)', async () => {
        const code = 'class Svc { def fetchData(): Future[String] = Future("x") }';
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.scala', 'scala', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fetchData');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBeFalsy();
    });

    test('@deprecated annotation is captured in decorators', async () => {
        const code = ['class Svc {', '  @deprecated("use newApi", "2.0")', '  def oldApi(): Unit = ()', '}'].join('\n');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.scala', 'scala', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'oldApi');
        expect(fn).toBeDefined();
        expect(fn!.decorators).toBeDefined();
        expect(fn!.decorators!.some((d) => d.includes('@deprecated'))).toBe(true);
    });

    test('@throws annotation is captured in both decorators and throws', async () => {
        const code = ['class Svc {', '  @throws[IOException]', '  def readFile(): String = ""', '}'].join('\n');
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.scala', 'scala', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'readFile');
        expect(fn).toBeDefined();
        expect(fn!.decorators).toBeDefined();
        expect(fn!.decorators!.some((d) => d.includes('@throws'))).toBe(true);
        expect(fn!.throws).toBeDefined();
        expect(fn!.throws).toContain('IOException');
    });

    test('method without @throws has empty throws', async () => {
        const code = 'class Svc { def noThrow(): Unit = () }';
        const root = await parseAsync('scala', code);
        const graph = emptyGraph();
        extractFromFile(root, 'Test.scala', 'scala', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'noThrow');
        expect(fn).toBeDefined();
        expect(fn!.throws ?? []).toEqual([]);
    });
});
