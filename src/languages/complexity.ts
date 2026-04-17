import type { SgNode } from '@ast-grep/napi';

/**
 * McCabe cyclomatic complexity: 1 + number of decision points.
 *
 * Each language passes its own list of branching AST kinds (if, for, while,
 * switch-case, catch, ternary, etc.). This keeps the helper language-agnostic
 * while letting each language define what counts as a decision point.
 *
 * Contract: the helper traverses the full subtree rooted at `fn` AND checks
 * `fn` itself. Callers must therefore exclude function-wrapper kinds
 * (e.g. `function_declaration`, `method_definition`, `arrow_function`) from
 * `branchKinds` — otherwise every function starts at complexity 2.
 *
 * Decision-point kinds are intentionally additive: if both `switch_statement`
 * and `switch_case` are passed, a switch with N cases contributes N+1 (which
 * is wrong). Pick one level; see language extractor branch-kind lists in
 * Task 4 for the canonical choice per language.
 *
 * Only NAMED nodes are counted (via `isNamed()`). Some grammars (notably
 * Ruby) reuse a keyword string like `if` as BOTH the named container-node
 * kind AND the anonymous keyword-leaf kind — counting both double-counts
 * every `if`. Filtering to named nodes keeps callers from having to care.
 */
export function computeCyclomatic(fn: SgNode, branchKinds: readonly string[]): number {
    if (branchKinds.length === 0) {
        return 1;
    }
    const kindSet = new Set(branchKinds);
    let count = 0;
    const stack: SgNode[] = [fn];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.isNamed() && kindSet.has(String(node.kind()))) {
            count++;
        }
        for (const child of node.children()) {
            stack.push(child);
        }
    }
    return 1 + count;
}
