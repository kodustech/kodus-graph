import { describe, expect, it } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import { computeCyclomatic } from '../../src/languages/complexity';

const TS_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'catch_clause',
    'ternary_expression',
    'case',
];

describe('computeCyclomatic', () => {
    it('returns 1 for a function with no branches', async () => {
        const tree = await parseAsync('TypeScript', 'function f() { return 1; }');
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(fn).not.toBeNull();
        expect(computeCyclomatic(fn!, TS_BRANCH_KINDS)).toBe(1);
    });

    it('counts if + else-if + while as 3 extra paths -> complexity 4', async () => {
        const src = `function f(x: number) {
            if (x > 0) { return 1; }
            else if (x < 0) { return -1; }
            while (x === 0) { x++; }
            return 0;
        }`;
        const tree = await parseAsync('TypeScript', src);
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(computeCyclomatic(fn!, TS_BRANCH_KINDS)).toBe(4);
    });

    it('returns 1 when no branch kinds are configured', async () => {
        const tree = await parseAsync('TypeScript', 'function f() { if (true) return; }');
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(computeCyclomatic(fn!, [])).toBe(1);
    });

    it('counts the root node if its own kind is in branchKinds (contract)', async () => {
        const tree = await parseAsync('TypeScript', 'function f() { return 1; }');
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(computeCyclomatic(fn!, ['function_declaration'])).toBe(2); // 1 + root itself
    });

    it('counts nested same-kind nodes independently', async () => {
        const src = `function f(x: number, y: number) {
            if (x > 0) {
                if (y > 0) { return 1; }
            }
            return 0;
        }`;
        const tree = await parseAsync('TypeScript', src);
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        expect(computeCyclomatic(fn!, ['if_statement'])).toBe(3); // 1 + 2 nested ifs
    });

    it('counts switch cases as individual decision points', async () => {
        const src = `function f(x: number) {
            switch (x) {
                case 1: return 'a';
                case 2: return 'b';
                case 3: return 'c';
                default: return 'd';
            }
        }`;
        const tree = await parseAsync('TypeScript', src);
        const fn = tree.root().find({ rule: { kind: 'function_declaration' } });
        const result = computeCyclomatic(fn!, ['switch_case']);
        // ast-grep's TS grammar emits `switch_case` for `case` clauses and a
        // separate `switch_default` kind for the `default` clause. So with
        // `['switch_case']` alone, 3 `case` clauses contribute 3 decision
        // points -> 1 (base) + 3 = 4. `default` is not counted here because
        // its kind is `switch_default`, which is not in the list.
        expect(result).toBe(4);
    });
});
