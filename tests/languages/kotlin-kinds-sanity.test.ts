// tests/languages/kotlin-kinds-sanity.test.ts
//
// Grammar-drift guard for the Kotlin extractor.
//
// The Kotlin extractor matches tree-sitter node kinds via the centralized
// `KOTLIN_KINDS` map (src/languages/kotlin/kinds.ts). A `@ast-grep/lang-kotlin`
// bump that renames/removes a node kind would silently break extraction with
// no error. This test parses a fixture exercising every kind and asserts each
// `KOTLIN_KINDS` value still appears in a real parse tree — turning that drift
// into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { KOTLIN_KINDS } from '../../src/languages/kotlin/kinds';
import '../../src/parser/languages';

// A single Kotlin source that triggers every node kind referenced by the
// extractor: imports, class/interface/enum/object declarations, heritage
// (delegation with and without constructor_invocation), DI annotations,
// primary-constructor val params, property declarations, extension-style
// types, casts (`as`) and infix operators, nullable + function types, and
// every branch-kind used for cyclomatic complexity.
const FIXTURE = `
import foo.bar.Baz

interface Repo {
    fun find(): Baz?
}

enum class Color { RED, GREEN }

object Singleton {
    fun helper() {}
}

@Service
class Service(val repo: Repo) : Base(), Repo {
    @Inject lateinit var logger: Logger

    suspend fun run(x: Int, cb: (Int) -> Unit): String {
        val a = Foo()
        val b: Bar = make()
        val c = something() as Qux
        val d = x shl 2
        repo.find()
        Singleton.helper()
        if (x > 0) {
        } else {
        }
        for (i in 0..x) {
        }
        while (x > 0) {
        }
        do {
        } while (x > 0)
        when (x) {
            1 -> {}
            else -> {}
        }
        try {
        } catch (e: Exception) {
        }
        return "ok"
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

describe('Kotlin KOTLIN_KINDS grammar-drift guard', () => {
    it('every KOTLIN_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('kotlin' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(KOTLIN_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-kotlin grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update KOTLIN_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });
});
