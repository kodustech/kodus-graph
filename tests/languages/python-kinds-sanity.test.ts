// tests/languages/python-kinds-sanity.test.ts
//
// Grammar-drift guard for the Python extractor.
//
// The Python extractor matches tree-sitter node kinds and field names via the
// centralized `PYTHON_KINDS` / `PYTHON_FIELDS` maps (src/languages/python/
// kinds.ts). A `@ast-grep/lang-python` bump that renames/removes a node kind
// or field would silently break extraction with no error. This test parses a
// fixture exercising every kind and field and asserts they still resolve in a
// real parse tree — turning that drift into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { PYTHON_FIELDS, PYTHON_KINDS } from '../../src/languages/python/kinds';
import '../../src/parser/languages';

// A single Python source that triggers every node kind referenced by the
// extractor: imports (regular / from / relative), class heritage, typed +
// default-typed params, generics, decorators, attribute calls, assignments,
// lambdas, raises, and every branch-kind used for cyclomatic complexity
// (if/elif/for/while/except/ternary/match-case).
const FIXTURE = `
import os
from .models import Repo
from typing import Dict, Optional

db = Database()


class Base:
    pass


class Service(Base):
    repo: Repo
    logger = Logger()

    def __init__(self, cache: Cache, opts: Dict[str, Foo] = None) -> None:
        self.cache = cache

    @property
    def value(self) -> int:
        return 1

    def run(self, x: int) -> str:
        svc = Foo()
        made = factory()
        svc.update(1)
        self.cache.get()
        z = x if x > 0 else -x
        if x > 0:
            pass
        elif x < 0:
            pass
        for i in range(x):
            pass
        while x:
            break
        try:
            raise ValueError("boom")
        except Exception:
            pass
        match x:
            case 1:
                pass
        fn = lambda a: a + 1
        return "ok"
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

describe('Python PYTHON_KINDS / PYTHON_FIELDS grammar-drift guard', () => {
    it('every PYTHON_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('python' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(PYTHON_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-python grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update PYTHON_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every PYTHON_FIELDS name resolves on its owning node', async () => {
        const root = await parseAsync('python' as never, FIXTURE);
        const rootNode = root.root();

        const classes: SgNode[] = [];
        collectByKind(rootNode, PYTHON_KINDS.classDefinition, classes);
        const functions: SgNode[] = [];
        collectByKind(rootNode, PYTHON_KINDS.functionDefinition, functions);

        // `name`, `body`, `superclasses` live on class_definition; the fixture's
        // `Service(Base)` exercises all three.
        const fieldResolves = (nodes: SgNode[], field: string) =>
            nodes.some((n) => n.field(field) !== null && n.field(field) !== undefined);

        expect(fieldResolves(classes, PYTHON_FIELDS.name)).toBe(true);
        expect(fieldResolves(classes, PYTHON_FIELDS.body)).toBe(true);
        expect(fieldResolves(classes, PYTHON_FIELDS.superclasses)).toBe(true);

        // `name`, `body`, `parameters`, `return_type` live on
        // function_definition; `run(self, x: int) -> str` exercises all four.
        expect(fieldResolves(functions, PYTHON_FIELDS.name)).toBe(true);
        expect(fieldResolves(functions, PYTHON_FIELDS.body)).toBe(true);
        expect(fieldResolves(functions, PYTHON_FIELDS.parameters)).toBe(true);
        expect(fieldResolves(functions, PYTHON_FIELDS.returnType)).toBe(true);
    });
});
