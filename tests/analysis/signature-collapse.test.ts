import { describe, expect, it } from 'bun:test';
import { groupInterchangeableImpls, renderImplClasses } from '../../src/analysis/signature-collapse';
import type { GraphEdge } from '../../src/graph/types';

/** INHERITS edge: source (child) extends target (base). */
function inherits(child: string, base: string): GraphEdge {
    return {
        kind: 'INHERITS',
        source_qualified: child,
        target_qualified: base,
        file_path: child.split('::')[0],
        line: 1,
    };
}

describe('groupInterchangeableImpls', () => {
    it('collapses same-named methods across siblings of a shared base', () => {
        const edges = [
            inherits('src/a.ts::PaginatorA', 'src/base.ts::BasePaginator'),
            inherits('src/b.ts::PaginatorB', 'src/base.ts::BasePaginator'),
            inherits('src/c.ts::PaginatorC', 'src/base.ts::BasePaginator'),
        ];
        const qns = [
            'src/a.ts::PaginatorA::getResult',
            'src/b.ts::PaginatorB::getResult',
            'src/c.ts::PaginatorC::getResult',
        ];

        const { groups, grouped } = groupInterchangeableImpls(qns, edges);

        expect(groups).toHaveLength(1);
        expect(groups[0].method).toBe('getResult');
        expect(groups[0].members).toHaveLength(3);
        expect(grouped.size).toBe(3);
        expect(renderImplClasses(groups[0])).toBe('PaginatorA, PaginatorB, PaginatorC');
    });

    it('does NOT collapse same-named methods without a shared base', () => {
        // Two unrelated `handle` functions — no INHERITS relation at all.
        const qns = ['src/x.ts::Foo::handle', 'src/y.ts::Bar::handle'];
        const { groups, grouped } = groupInterchangeableImpls(qns, []);
        expect(groups).toHaveLength(0);
        expect(grouped.size).toBe(0);
    });

    it('does NOT collapse siblings when the method name differs', () => {
        const edges = [inherits('src/a.ts::A', 'src/base.ts::Base'), inherits('src/b.ts::B', 'src/base.ts::Base')];
        const qns = ['src/a.ts::A::foo', 'src/b.ts::B::bar'];
        const { groups } = groupInterchangeableImpls(qns, edges);
        expect(groups).toHaveLength(0);
    });

    it('does not collapse a lone override (needs >= 2 members present)', () => {
        const edges = [inherits('src/a.ts::A', 'src/base.ts::Base')];
        const qns = ['src/a.ts::A::getResult']; // only one sibling in the input
        const { groups, grouped } = groupInterchangeableImpls(qns, edges);
        expect(groups).toHaveLength(0);
        expect(grouped.has('src/a.ts::A::getResult')).toBe(false);
    });

    it('ignores top-level functions (no class segment)', () => {
        const qns = ['src/a.ts::freeFunction', 'src/b.ts::otherFree'];
        const { groups } = groupInterchangeableImpls(qns, []);
        expect(groups).toHaveLength(0);
    });

    it('renderImplClasses truncates with a +k remainder', () => {
        const edges = ['A', 'B', 'C', 'D', 'E'].map((c) => inherits(`src/${c}.ts::${c}`, 'src/base.ts::Base'));
        const qns = ['A', 'B', 'C', 'D', 'E'].map((c) => `src/${c}.ts::${c}::run`);
        const { groups } = groupInterchangeableImpls(qns, edges);
        expect(groups).toHaveLength(1);
        expect(renderImplClasses(groups[0], 3)).toBe('A, B, C +2');
    });
});
