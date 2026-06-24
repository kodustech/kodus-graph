// tests/languages/php-kinds-sanity.test.ts
//
// Grammar-drift guard for the PHP extractor.
//
// The PHP extractor matches tree-sitter node kinds (and field names) via the
// centralized `PHP_KINDS` / `PHP_FIELDS` maps (src/languages/php/kinds.ts). A
// `@ast-grep/lang-php` bump that renames/removes a node kind would silently
// break extraction with no error. This test parses a fixture exercising every
// kind and asserts each `PHP_KINDS` value still appears in a real parse tree —
// turning that drift into a hard failure. A companion test checks every
// `PHP_FIELDS` value resolves on some node in the same tree.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { PHP_FIELDS, PHP_KINDS } from '../../src/languages/php/kinds';
import '../../src/parser/languages';

// A single PHP source that triggers every node kind referenced by the
// extractor: namespace + use imports (plain, grouped, aliased, string-ish via
// a string literal), interface/trait/enum/class declarations, heritage
// (extends + implements), typed properties, a promoted-property constructor
// for DI, methods + a free function, attributes/modifiers, every call kind
// (function/member/scoped/object-creation), `new`/assignment bindings, and
// every branch kind used for cyclomatic complexity (if/elseif/for/foreach/
// while/do/switch+case/catch/ternary/throw).
const FIXTURE = `<?php
namespace App\\Service;

use App\\Repo\\UserRepository;
use App\\Repo\\{Foo, Bar};
use Some\\Thing as Alias;

interface RepoInterface {
    public function find(): string;
}

trait LoggerTrait {
    public function log(string $m): void {}
}

class BaseService {}

#[Attribute]
class UserService extends BaseService implements RepoInterface {
    use LoggerTrait;

    private UserRepository $repo;

    public function __construct(private Alias $client) {}

    public function find(): string {
        $obj = new Foo();
        $obj->doThing();
        $this->repo->load();
        helperFunction();
        Foo::staticCall();
        parent::log("x");
        self::find();

        if ($obj) {
            return "a";
        } elseif (!$obj) {
            return "b";
        }
        for ($i = 0; $i < 3; $i++) {}
        foreach ([1, 2] as $v) {}
        while ($obj) {}
        do {} while ($obj);
        switch ($obj) {
            case 1:
                break;
        }
        try {
        } catch (\\Exception $e) {
            throw $e;
        }
        return $obj ? "y" : "z";
    }
}

function helperFunction(): void {}
`;

/** Depth-first walk collecting every node kind present in the tree. */
function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

describe('PHP PHP_KINDS grammar-drift guard', () => {
    it('every PHP_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('php' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(PHP_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-php grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update PHP_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every PHP_FIELDS value resolves on some node in a real parse tree', async () => {
        const root = await parseAsync('php' as never, FIXTURE);

        const fieldsSeen = new Set<string>();
        const walk = (node: SgNode): void => {
            for (const field of Object.values(PHP_FIELDS)) {
                if (node.field(field)) {
                    fieldsSeen.add(field);
                }
            }
            for (const child of node.children()) {
                walk(child);
            }
        };
        walk(root.root());

        const missing = Object.entries(PHP_FIELDS)
            .filter(([, field]) => !fieldsSeen.has(field))
            .map(([name, field]) => `${name} ('${field}')`);

        expect(missing).toEqual([]);
    });
});
