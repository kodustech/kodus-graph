// tests/languages/typescript-kinds-sanity.test.ts
//
// Grammar-drift guard for the shared TypeScript / TSX / JavaScript extractor.
//
// The extractor matches tree-sitter node kinds and field names via the
// centralized `TS_KINDS` / `TS_FIELDS` maps (src/languages/typescript/
// kinds.ts). These grammars are built into @ast-grep/napi (no lang-* package
// with a node-types.json), so this guard parses a TS fixture and a TSX fixture
// and asserts every kind appears in the union and every field resolves. A napi
// bump that changes a kind/field becomes a hard failure instead of silent
// extraction loss.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { Lang, parseAsync } from '@ast-grep/napi';
import { TS_FIELDS, TS_KINDS } from '../../src/languages/typescript/kinds';
import '../../src/parser/languages';

// TS fixture: imports (default/named/namespace), re-exports, interface + enum,
// abstract + concrete classes with heritage, constructor DI params
// (accessibility modifiers + generic types), arrow + function expressions,
// new/as expressions, member-expression receivers, optional params, and every
// branch kind.
const TS_FIXTURE = `
import defaultExport, { named1, named2 } from "./mod";
import * as ns from "./ns";

export const reExportSrc = 1;
export { foo } from "./bar";

interface Repo {
    find(): void;
}

enum Color {
    Red,
    Green,
}

abstract class Base {
    abstract run(): void;
}

class Service extends Base implements Repo {
    constructor(
        private repo: Repo,
        public logger: Logger<string>,
    ) {
        super();
    }

    find(): void {}

    run(): void {
        const a: Foo = makeFoo();
        const b = new Bar();
        const c = something() as Qux;
        const d = new pkg.Thing();
        this.repo.find();
        ns.helper();
        const fn = function () {
            return 1;
        };
        const arrow = (x: number): number => x + 1;
        if (a) {
        }
        for (let i = 0; i < 1; i++) {
        }
        for (const k in b) {
        }
        while (a) {
        }
        do {
        } while (a);
        switch (a) {
            case 1:
                break;
        }
        try {
        } catch (e) {
        }
        const t = a ? 1 : 2;
    }
}

function makeFoo(x?: string): Foo {
    return new Foo();
}
`;

// TSX fixture: JSX element kinds — self-closing, opening, nested-identifier
// (`<Foo.Bar />`) and namespace-name (`<ns:Tag />`) component tags.
const TSX_FIXTURE = `
const App = () => {
    return (
        <div>
            <UserCard name="x" />
            <Foo.Bar />
            <ns:Tag />
            <Wrapper>hi</Wrapper>
        </div>
    );
};
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

describe('TS / TSX / JS TS_KINDS / TS_FIELDS grammar-drift guard', () => {
    it('every TS_KINDS value appears across the TS and TSX parse trees', async () => {
        const present = new Set<string>();
        const tsRoot = await parseAsync(Lang.TypeScript, TS_FIXTURE);
        collectKinds(tsRoot.root(), present);
        const tsxRoot = await parseAsync(Lang.Tsx, TSX_FIXTURE);
        collectKinds(tsxRoot.root(), present);

        const missing = Object.entries(TS_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a napi bump changed TS/TSX node kinds (or the fixtures
        // no longer trigger one). Update TS_KINDS + extractor, or extend the
        // fixtures to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every TS_FIELDS name resolves on some node', async () => {
        const tsRoot = await parseAsync(Lang.TypeScript, TS_FIXTURE);
        const rootNode = tsRoot.root();

        const byKind = (kind: string) => {
            const out: SgNode[] = [];
            collectByKind(rootNode, kind, out);
            return out;
        };
        const fieldResolves = (nodes: SgNode[], field: string) =>
            nodes.some((n) => n.field(field) !== null && n.field(field) !== undefined);

        // name/parameters/return_type → method_definition; body → interface;
        // constructor → new_expression; object/property → member_expression;
        // pattern → required_parameter; function → call_expression.
        expect(fieldResolves(byKind(TS_KINDS.methodDefinition), TS_FIELDS.name)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.methodDefinition), TS_FIELDS.parameters)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.functionDeclaration), TS_FIELDS.returnType)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.interfaceDeclaration), TS_FIELDS.body)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.newExpression), TS_FIELDS.constructor)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.memberExpression), TS_FIELDS.object)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.memberExpression), TS_FIELDS.property)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.requiredParameter), TS_FIELDS.pattern)).toBe(true);
        expect(fieldResolves(byKind(TS_KINDS.callExpression), TS_FIELDS.function)).toBe(true);
    });
});
