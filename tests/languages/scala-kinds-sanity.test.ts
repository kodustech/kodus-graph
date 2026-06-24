// tests/languages/scala-kinds-sanity.test.ts
//
// Grammar-drift guard for the Scala extractor.
//
// The Scala extractor matches tree-sitter node kinds via the centralized
// `SCALA_KINDS` map (src/languages/scala/kinds.ts), plus named fields via
// `SCALA_FIELDS`. A `@ast-grep/lang-scala` bump that renames/removes a node
// kind would silently break extraction with no error. This test parses a
// fixture exercising every kind and asserts each `SCALA_KINDS` value still
// appears in a real parse tree — turning that drift into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { SCALA_FIELDS, SCALA_KINDS } from '../../src/languages/scala/kinds';
import '../../src/parser/languages';

// A single Scala source that triggers every node kind referenced by the
// extractor: package + imports (plain + wildcard `_`), trait with abstract
// (function_declaration) and concrete (function_definition) methods, a case
// class with heritage (`extends ... with ...`), a case object, annotations
// (incl. `@throws`), val definitions (`new Foo()` instance_expression,
// explicit type, and bare factory call_expression), method params with
// generic types, field/call expressions, and every branch kind used for
// cyclomatic complexity (if/for/while/do-while/match-case + catch case).
const FIXTURE = `
package com.example

import com.example.models.User
import com.example.services._

trait Repo {
  def find(): User
  def save(u: User): Unit = ()
}

@Service
case class UserService(repo: Repo) extends Base with Repo with Logging {
  val explicit: Logger = makeLogger
  val created = new User()
  val built = factory()

  @throws[RuntimeException]
  def handle(u: User, items: List[String]): String = {
    if (u != null) {
      repo.save(u)
    } else if (items.isEmpty) {
      repo.find()
    }
    for (i <- items) {
      println(i)
    }
    while (items.nonEmpty) {
      println("loop")
    }
    do {
      println("once")
    } while (false)
    val result = u match {
      case x: User => "user"
      case _ => "other"
    }
    try {
      repo.find()
    } catch {
      case e: RuntimeException => "err"
    }
    Helper.staticCall()
    result
  }
}

case object Singleton extends Repo {
  def find(): User = new User()
}
`;

/** Depth-first walk collecting every node kind present in the tree. */
function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

describe('Scala SCALA_KINDS grammar-drift guard', () => {
    it('every SCALA_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('scala' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(SCALA_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-scala grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update SCALA_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });

    it('every SCALA_FIELDS field resolves on a node that declares it', async () => {
        const root = await parseAsync('scala' as never, FIXTURE);
        // The `function` field is exposed by call_expression. Find one and
        // assert the field resolves to a real child node.
        const call = root.root().find({ rule: { kind: SCALA_KINDS.callExpression } });
        expect(call).not.toBeNull();
        const fn = call?.field(SCALA_FIELDS.function);
        expect(fn).not.toBeNull();
    });
});
