import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { CSHARP_FIELDS, CSHARP_KINDS } from '../../src/languages/csharp/kinds';
import '../../src/parser/languages';

// Grammar-drift guard: parse C# source that exercises every kind/field the
// extractor depends on, then assert the active @ast-grep/lang-csharp grammar
// actually emits each one. If a grammar upgrade renames or drops a kind, this
// fails instead of the extractor silently producing empty results.

const FIXTURE = `
using System;
using System.Collections.Generic;
using static System.Math;

namespace App
{
    public interface IRepo<T> { }

    public enum Color { Red, Green, Blue }

    public struct Point { public int X; public int Y; }

    public record Dep(IRepo<int> Repo);

    public class Service<T> : BaseService, IRepo<T>
    {
        private readonly ILogger _log;
        public IRepo<T> Repo { get; set; }
        public int Count;

        [Test]
        public Service(IRepo<T> repo, int? maybe, string[] names)
        {
            this.Repo = repo;
        }

        [TestMethod]
        public async Task<int> RunAsync(IRepo<T> dep, int n, double d)
        {
            int Local(int x) { return x + 1; }
            var local = Local(n);

            var widget = new Widget();
            Widget other = new Widget();
            var produced = factory();

            if (n > 0)
            {
                for (int i = 0; i < n; i++)
                {
                    foreach (var name in names)
                    {
                        _log.Log(name);
                    }
                }
            }

            while (n > 0)
            {
                n--;
            }

            do
            {
                n++;
            } while (n < 10);

            switch (n)
            {
                case 1:
                    break;
                default:
                    break;
            }

            var ternary = n > 0 ? 1 : 2;

            try
            {
                widget.Method();
                widget?.Method();
                this.Repo.ToString();
                Console.WriteLine("hi");
            }
            catch (Exception e)
            {
                throw new Exception(e.Message);
            }

            return await Task.FromResult(ternary);
        }
    }
}
`;

function collectKinds(node: SgNode, into: Set<string>): void {
    into.add(String(node.kind()));
    for (const child of node.children()) {
        collectKinds(child, into);
    }
}

function collectByKind(node: SgNode, kind: string, into: SgNode[]): void {
    if (String(node.kind()) === kind) {
        into.push(node);
    }
    for (const child of node.children()) {
        collectByKind(child, kind, into);
    }
}

describe('C# kinds sanity', () => {
    it('emits every kind referenced in CSHARP_KINDS', async () => {
        const root = (await parseAsync('csharp' as never, FIXTURE)).root();
        const present = new Set<string>();
        collectKinds(root, present);

        const missing = Object.entries(CSHARP_KINDS)
            .filter(([, k]) => !present.has(k))
            .map(([name, k]) => `${name} ('${k}')`);

        expect(missing).toEqual([]);
    });

    it('resolves every field in CSHARP_FIELDS on its owning kind', async () => {
        const root = (await parseAsync('csharp' as never, FIXTURE)).root();

        // Map each field to a kind whose nodes are expected to expose it.
        const fieldOwners: Record<string, string> = {
            [CSHARP_FIELDS.name]: CSHARP_KINDS.methodDeclaration,
            [CSHARP_FIELDS.parameters]: CSHARP_KINDS.methodDeclaration,
            [CSHARP_FIELDS.returns]: CSHARP_KINDS.methodDeclaration,
            [CSHARP_FIELDS.type]: CSHARP_KINDS.objectCreationExpression,
            [CSHARP_FIELDS.function]: CSHARP_KINDS.invocationExpression,
            [CSHARP_FIELDS.expression]: CSHARP_KINDS.memberAccessExpression,
        };

        const unresolved: string[] = [];
        for (const field of Object.values(CSHARP_FIELDS)) {
            const ownerKind = fieldOwners[field];
            const owners: SgNode[] = [];
            collectByKind(root, ownerKind, owners);
            const resolved = owners.some((n) => n.field(field) != null);
            if (!resolved) {
                unresolved.push(`${field} (on '${ownerKind}')`);
            }
        }

        expect(unresolved).toEqual([]);
    });
});
