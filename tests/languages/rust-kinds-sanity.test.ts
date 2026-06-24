// tests/languages/rust-kinds-sanity.test.ts
//
// Grammar-drift guard for the Rust extractor.
//
// The Rust extractor matches tree-sitter node kinds and field names via the
// centralized `RUST_KINDS` / `RUST_FIELDS` maps (src/languages/rust/kinds.ts).
// A `@ast-grep/lang-rust` bump that renames/removes a node kind or field would
// silently break extraction with no error. This test parses a fixture
// exercising every kind/field and asserts each value still appears in a real
// parse tree — turning that drift into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { RUST_FIELDS, RUST_KINDS } from '../../src/languages/rust/kinds';
import '../../src/parser/languages';

// A single Rust source that triggers every node kind referenced by the
// extractor: use declarations (scoped + plain), pub structs/enums/traits with
// visibility modifiers, an impl block with methods, attributes (`#[...]`),
// let bindings (with explicit type, scoped-call init), parameters with
// reference + generic types, method/field calls, and every branch kind used
// for cyclomatic complexity (if / match arm / for / while / loop).
const FIXTURE = `
use std::collections::HashMap;
use foo::Bar;

#[derive(Debug)]
pub struct Repo {
    items: HashMap<String, u32>,
}

pub enum Color {
    Red,
    Green,
}

pub trait Store {
    fn load(&self) -> u32;
}

impl Store for Repo {
    fn load(&self) -> u32 {
        0
    }
}

impl Repo {
    #[inline]
    pub fn run(&self, other: &Repo, list: Vec<u32>, sv: std::vec::Vec<u32>) -> u32 {
        let a = Repo::new();
        let b: u32 = 5;
        a.load();
        other.load();
        if b > 0 {
        } else {
        }
        for _i in 0..b {
        }
        while b > 0 {
            break;
        }
        loop {
            break;
        }
        match b {
            0 => {}
            _ => {}
        }
        b
    }
}
`;

/** Depth-first walk collecting every node kind present in the tree. */
function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

describe('Rust RUST_KINDS / RUST_FIELDS grammar-drift guard', () => {
    it('every RUST_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('rust' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(RUST_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-rust grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update RUST_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every RUST_FIELDS value resolves on some node in a real parse tree', async () => {
        const root = await parseAsync('rust' as never, FIXTURE);

        // Collect every field name that resolves on any node in the tree.
        const seen = new Set<string>();
        const fieldNames = Object.values(RUST_FIELDS);
        (function walk(node: SgNode): void {
            for (const f of fieldNames) {
                if (node.field(f) != null) {
                    seen.add(f);
                }
            }
            for (const child of node.children()) {
                walk(child);
            }
        })(root.root());

        const missing = Object.entries(RUST_FIELDS)
            .filter(([, field]) => !seen.has(field))
            .map(([name, field]) => `${name} ('${field}')`);

        expect(missing).toEqual([]);
    });
});
