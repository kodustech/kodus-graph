// tests/languages/ruby-kinds-sanity.test.ts
//
// Grammar-drift guard for the Ruby extractor.
//
// The Ruby extractor matches tree-sitter node kinds and field names via the
// centralized `RUBY_KINDS` / `RUBY_FIELDS` maps (src/languages/ruby/kinds.ts).
// A `@ast-grep/lang-ruby` bump that renames/removes a node kind or field would
// silently break extraction with no error. This test parses a fixture
// exercising every kind and field and asserts they still resolve in a real
// parse tree — turning that drift into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { RUBY_FIELDS, RUBY_KINDS } from '../../src/languages/ruby/kinds';
import '../../src/parser/languages';

// A single Ruby source that triggers every node kind referenced by the
// extractor: module, class (+ superclass), regular + singleton methods,
// require/require_relative, attr_accessor, method/call expressions, instance
// var assignments, bare identifier calls, and every branch kind used for
// cyclomatic complexity (if/elsif/unless/while/until/for/when/rescue/ternary
// plus their modifier forms).
const FIXTURE = `
require 'json'
require_relative 'helper'

module Tools
  class Base
  end

  class Service < Base
    attr_accessor :name

    def initialize(name)
      @name = name
      setup
    end

    def self.build(name)
      new(name)
    end

    def run(x)
      svc = Helper.new
      svc.update(1)
      self.log(x)
      z = x > 0 ? x : -x
      if x > 0
        z += 1
      elsif x < 0
        z -= 1
      else
        z = 0
      end
      unless x.nil?
        z += 1
      end
      while x > 0
        x -= 1
      end
      until x <= 0
        x -= 1
      end
      for i in 0..x
        z += i
      end
      case x
      when 1
        z = 1
      when 2
        z = 2
      end
      begin
        raise 'boom'
      rescue StandardError => e
        z = 0
      end
      z += 1 if x > 0
      z -= 1 unless x.nil?
      z += 1 while x > 0
      z -= 1 until x <= 0
      z
    end
  end
end
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

describe('Ruby RUBY_KINDS / RUBY_FIELDS grammar-drift guard', () => {
    it('every RUBY_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('ruby' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(RUBY_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-ruby grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update RUBY_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every RUBY_FIELDS name resolves on its owning node', async () => {
        const root = await parseAsync('ruby' as never, FIXTURE);
        const rootNode = root.root();

        const classes: SgNode[] = [];
        collectByKind(rootNode, RUBY_KINDS.classDeclaration, classes);
        const methods: SgNode[] = [];
        collectByKind(rootNode, RUBY_KINDS.method, methods);
        const calls: SgNode[] = [];
        collectByKind(rootNode, RUBY_KINDS.call, calls);

        const fieldResolves = (nodes: SgNode[], field: string) =>
            nodes.some((n) => n.field(field) !== null && n.field(field) !== undefined);

        // `name`, `superclass` live on class; `Service < Base` exercises both.
        expect(fieldResolves(classes, RUBY_FIELDS.name)).toBe(true);
        expect(fieldResolves(classes, RUBY_FIELDS.superclass)).toBe(true);

        // `name`, `parameters` live on method; `run(x)` exercises both.
        expect(fieldResolves(methods, RUBY_FIELDS.name)).toBe(true);
        expect(fieldResolves(methods, RUBY_FIELDS.parameters)).toBe(true);

        // `method`, `receiver` live on call; `svc.update(1)` exercises both.
        expect(fieldResolves(calls, RUBY_FIELDS.method)).toBe(true);
        expect(fieldResolves(calls, RUBY_FIELDS.receiver)).toBe(true);
    });
});
