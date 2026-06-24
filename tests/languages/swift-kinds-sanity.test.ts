// tests/languages/swift-kinds-sanity.test.ts
//
// Grammar-drift guard for the Swift extractor.
//
// The Swift extractor matches tree-sitter node kinds via the centralized
// `SWIFT_KINDS` map (src/languages/swift/kinds.ts). A `@ast-grep/lang-swift`
// bump that renames/removes a node kind would silently break extraction with
// no error. This test parses a fixture exercising every kind and asserts each
// `SWIFT_KINDS` value still appears in a real parse tree — turning that drift
// into a hard failure.
import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { SWIFT_KINDS } from '../../src/languages/swift/kinds';
import '../../src/parser/languages';

// A single Swift source that triggers every node kind referenced by the
// extractor: imports, class/struct/enum (shared class_declaration kind),
// protocols with method signatures, inheritance, init/deinit, attributes +
// modifiers, throwing functions, typed params and properties, navigation-
// expression calls, every return-type shape, and every branch kind.
const FIXTURE = `
import Foundation

protocol Repo {
    func find() -> Int
}

struct Point: Equatable {
    var x: Int
}

enum Color {
    case red
}

class Base {}

class Service: Base, Repo {
    public var repo: Repo
    let logger = Logger()

    @objc public init(repo: Repo) {
        self.repo = repo
    }

    deinit {}

    func find() -> Int {
        return 1
    }

    open func run(_ n: Int, with other: Repo) throws -> [String]? {
        let made = Maker()
        repo.find()
        other.find()
        if n > 0 {
        }
        guard n > 0 else {
            return nil
        }
        for i in 0..<n {
        }
        while n > 0 {
        }
        repeat {
        } while n > 0
        switch n {
        case 1:
            break
        default:
            break
        }
        do {
            try risky()
        } catch {
        }
        let t = n > 0 ? 1 : 2
        let dict: [String: Int] = [:]
        let tuple: (Int, Int) = (1, 2)
        return nil
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

describe('Swift SWIFT_KINDS grammar-drift guard', () => {
    it('every SWIFT_KINDS value appears in a real parse tree', async () => {
        const root = await parseAsync('swift' as never, FIXTURE);
        const present = new Set<string>();
        collectKinds(root.root(), present);

        const missing = Object.entries(SWIFT_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([name, kind]) => `${name} ('${kind}')`);

        // If this fails, a lang-swift grammar bump changed node kinds (or the
        // fixture no longer triggers one). Update SWIFT_KINDS + extractor, or
        // extend the fixture to cover the kind again.
        expect(missing).toEqual([]);
    });
});
