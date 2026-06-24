// tests/languages/c-kinds-sanity.test.ts
//
// Grammar-drift guard for the shared C / C++ extractor.
//
// The extractor (registered for both `c` and `cpp`) matches tree-sitter node
// kinds and field names via the centralized `C_KINDS` / `C_FIELDS` maps
// (src/languages/c/kinds.ts). Some kinds exist only in the C++ grammar and are
// reached only when parsing C++ — so this guard parses BOTH a C and a C++
// fixture and asserts every kind appears in the union, and every field still
// resolves. A `@ast-grep/lang-c` or `@ast-grep/lang-cpp` bump that renames a
// kind/field becomes a hard failure instead of silent extraction loss.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { C_FIELDS, C_KINDS } from '../../src/languages/c/kinds';
import '../../src/parser/languages';

// C fixture: typedef-struct, struct, enum, storage/type specifiers, every
// declarator form, includes (system + local), member + bare calls, and every
// branch kind.
const C_FIXTURE = `
#include <stdio.h>
#include "local.h"

typedef struct Point { int x; } Point;

struct Node { int v; };

enum Color { RED, GREEN };

static const unsigned int g = 0;

int* compute(int n, char buf[]) {
    Point p;
    Point *pp = &p;
    int arr[3];
    if (n > 0) {
    }
    for (int i = 0; i < n; i++) {
    }
    while (n) {
    }
    do {
    } while (n);
    switch (n) {
        case 1:
            break;
    }
    int y = n > 0 ? 1 : 2;
    foo();
    pp->compute(1);
    return pp;
}
`;

// C++ fixture: classes with heritage, access specifiers, templates, `this`,
// reference declarators, qualified/namespaced calls and out-of-class method
// definitions, and try/catch.
const CPP_FIXTURE = `
#include <string>

class Base {};

class Service : public Base {
public:
    void run();
    void helper() {
        this->run();
    }
};

template <typename T>
class Box : public Base {
    T val;
};

void Service::run() {
    Service &ref = *this;
    try {
    } catch (int e) {
    }
    Foo::bar();
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

describe('C / C++ C_KINDS / C_FIELDS grammar-drift guard', () => {
    it('every C_KINDS value appears across the C and C++ parse trees', async () => {
        const present = new Set<string>();
        for (const [lang, src] of [
            ['c', C_FIXTURE],
            ['cpp', CPP_FIXTURE],
        ] as const) {
            const root = await parseAsync(lang as never, src);
            collectKinds(root.root(), present);
        }

        const missing = Object.entries(C_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-c / lang-cpp grammar bump changed node kinds
        // (or the fixtures no longer trigger one). Update C_KINDS + extractor,
        // or extend the fixtures to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every C_FIELDS name resolves on its owning node', async () => {
        const root = await parseAsync('c' as never, C_FIXTURE);
        const rootNode = root.root();

        const calls: SgNode[] = [];
        collectByKind(rootNode, C_KINDS.callExpression, calls);
        const fieldExprs: SgNode[] = [];
        collectByKind(rootNode, C_KINDS.fieldExpression, fieldExprs);
        const declarations: SgNode[] = [];
        collectByKind(rootNode, C_KINDS.declaration, declarations);

        const fieldResolves = (nodes: SgNode[], field: string) =>
            nodes.some((n) => n.field(field) !== null && n.field(field) !== undefined);

        // `function` lives on call_expression; `argument` on field_expression;
        // `type` on declaration. The C fixture exercises all three.
        expect(fieldResolves(calls, C_FIELDS.function)).toBe(true);
        expect(fieldResolves(fieldExprs, C_FIELDS.argument)).toBe(true);
        expect(fieldResolves(declarations, C_FIELDS.type)).toBe(true);
    });
});
