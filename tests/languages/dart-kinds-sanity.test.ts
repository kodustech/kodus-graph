// tests/languages/dart-kinds-sanity.test.ts
//
// Grammar-drift guard for the Dart extractor.
//
// The Dart extractor matches tree-sitter node kinds via the centralized
// `DART_KINDS` map (src/languages/dart/kinds.ts). If a `@ast-grep/lang-dart`
// bump renames or removes a node kind, the extractor would silently stop
// matching and produce empty/partial graphs with no error. This test parses a
// fixture that exercises every kind and asserts each `DART_KINDS` value still
// appears in a real parse tree — turning that drift into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { DART_FORMAL_PARAMETER_SUFFIX, DART_KINDS } from '../../src/languages/dart/kinds';
import '../../src/parser/languages';

// A single Dart source that triggers every node kind referenced by the
// extractor: heritage (extends/with/implements), mixins with `on`, extensions,
// enums, abstract methods, constructors/factories/getters/setters, annotations,
// async + Futures, default params, new-expressions, receiver calls
// (this/super/local), and every branch-kind used for cyclomatic complexity.
const FIXTURE = `
import 'package:meta/meta.dart';

enum Color { red, green }

abstract class Base {
  void abstractMethod();
  void log() {}
}

mixin Logger on Base {
  void emit() {}
}

extension StringX on String {
  String shout() => this.toUpperCase();
}

class Service extends Base with Logger implements Comparable {
  static int counter = 0;
  int _value = 0;

  Service();

  factory Service.create() => Service();

  int get value => _value;
  set value(int v) {
    _value = v;
  }

  @override
  void abstractMethod() {}

  @Deprecated('use run instead')
  Future<void> run([int retries = 3]) async {
    var s = new Service();
    Base b = s;
    this.helper();
    super.log();
    s.shout();

    if (retries > 0) {
      counter = retries > 1 ? 1 : 2;
    }
    for (var i = 0; i < retries; i++) {}
    while (counter < 10) {
      counter++;
    }
    do {
      counter++;
    } while (counter < 20);
    switch (counter) {
      case 1:
        break;
    }
    try {
      helper();
    } catch (e) {}
  }

  void helper() {}
}

void topLevel(String name) {
  print(name);
}
`;

/** Depth-first walk collecting every node kind present in the tree. */
function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

describe('Dart DART_KINDS grammar-drift guard', () => {
    it('every DART_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('dart' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(DART_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-dart grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update DART_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('the formal-parameter suffix still matches at least one node kind', async () => {
        const root = await parseAsync('dart' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const matches = [...present].filter((k) => k.endsWith(DART_FORMAL_PARAMETER_SUFFIX));
        expect(matches.length).toBeGreaterThan(0);
    });
});
