// tests/languages/java-kinds-sanity.test.ts
//
// Grammar-drift guard for the Java extractor.
//
// The extractor matches tree-sitter node kinds and field names via the
// centralized `JAVA_KINDS` / `JAVA_FIELDS` maps (src/languages/java/kinds.ts).
// This guard parses a fixture exercising every kind and asserts none have
// disappeared, plus that every field still resolves on its owning node. A
// `@ast-grep/lang-java` bump that renames a kind/field becomes a hard failure
// instead of silent extraction loss.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { JAVA_FIELDS, JAVA_KINDS } from '../../src/languages/java/kinds';
import '../../src/parser/languages';

// Java fixture: package + imports (scoped + wildcard + single identifier),
// class with extends/implements + generics, record, interface, enum, fields
// (typed reference + generic + scoped-type), a stereotype-annotated class with
// an @Inject/@Autowired constructor (DI), methods with annotations (marker +
// arg-bearing), modifiers, throws, generics, object creation, field access,
// `this`/`super` calls, local var declarations, and every branch kind
// (if / for / enhanced-for / while / do / switch+case / catch / ternary).
const JAVA_FIXTURE = `
package com.example.app;

import java.util.List;
import java.util.Map;
import java.util.*;
import Foo;

@Service
@RequestMapping("/users")
public class UserService extends Base implements Runnable, Comparable<UserService> {
    private final UserRepository repo;
    private List<String> names;
    private java.util.concurrent.ExecutorService pool;

    @Inject
    public UserService(UserRepository repo, OrderService orders) {
        super();
        this.repo = repo;
    }

    @Deprecated
    @Test
    public <T> T doWork(int x, Map<String, Integer> m) throws IOException, RuntimeException {
        if (x > 0) {
            for (int i = 0; i < x; i++) {
            }
        }
        for (String s : names) {
        }
        while (x > 0) {
            x--;
        }
        do {
            x--;
        } while (x > 0);
        switch (x) {
            case 1:
                break;
            default:
                break;
        }
        try {
            this.repo.findAll();
            super.toString();
        } catch (Exception e) {
        }
        var r = factory();
        UserService u = new UserService(repo, null);
        return x > 0 ? null : null;
    }
}

interface MyIface {
    void op();
}

enum Color {
    RED,
    GREEN
}

record Point(int x, int y) {
}
`;

/** Depth-first walk collecting every node kind present in the tree. */
function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

/** Depth-first collect of all nodes of a given kind. */
function collectByKind(node: SgNode, kind: string, into: SgNode[]): void {
    if (String(node.kind()) === kind) {
        into.push(node);
    }
    for (const child of node.children()) {
        collectByKind(child, kind, into);
    }
}

describe('Java JAVA_KINDS / JAVA_FIELDS grammar-drift guard', () => {
    it('every JAVA_KINDS value appears in the parse tree', async () => {
        const root = await parseAsync('java' as never, JAVA_FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(JAVA_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-java grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update JAVA_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every JAVA_FIELDS name resolves on its owning node', async () => {
        const root = await parseAsync('java' as never, JAVA_FIXTURE);
        const rootNode = root.root();

        const methods: SgNode[] = [];
        collectByKind(rootNode, JAVA_KINDS.METHOD_DECLARATION, methods);
        const classes: SgNode[] = [];
        collectByKind(rootNode, JAVA_KINDS.CLASS_DECLARATION, classes);
        const declarators: SgNode[] = [];
        collectByKind(rootNode, JAVA_KINDS.VARIABLE_DECLARATOR, declarators);
        const invocations: SgNode[] = [];
        collectByKind(rootNode, JAVA_KINDS.METHOD_INVOCATION, invocations);
        const fieldAccesses: SgNode[] = [];
        collectByKind(rootNode, JAVA_KINDS.FIELD_ACCESS, fieldAccesses);

        const fieldResolves = (nodes: SgNode[], field: string) =>
            nodes.some((n) => n.field(field) !== null && n.field(field) !== undefined);

        // name/type/parameters/body live on method_declaration; value on a
        // variable_declarator with an initializer; object on method_invocation;
        // field on field_access. The fixture exercises all of them.
        expect(fieldResolves(methods, JAVA_FIELDS.NAME)).toBe(true);
        expect(fieldResolves(methods, JAVA_FIELDS.TYPE)).toBe(true);
        expect(fieldResolves(methods, JAVA_FIELDS.PARAMETERS)).toBe(true);
        expect(fieldResolves(methods, JAVA_FIELDS.BODY)).toBe(true);
        expect(fieldResolves(classes, JAVA_FIELDS.BODY)).toBe(true);
        expect(fieldResolves(declarators, JAVA_FIELDS.VALUE)).toBe(true);
        expect(fieldResolves(invocations, JAVA_FIELDS.OBJECT)).toBe(true);
        expect(fieldResolves(fieldAccesses, JAVA_FIELDS.FIELD)).toBe(true);
    });
});
