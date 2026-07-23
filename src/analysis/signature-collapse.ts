import type { GraphEdge } from '../graph/types';

/**
 * A set of interchangeable method implementations — the same method name
 * declared across classes that share a common base (via INHERITS). Rendering
 * one of these as a single "method ×N (ClassA, ClassB, …)" entry collapses the
 * polymorphic fan-out that otherwise repeats near-identical lines for every
 * subclass, without losing the fact that N implementations exist.
 */
export interface SiblingImplGroup {
    /** Group key: `${baseClassQN}::${method}` — stable and deterministic. */
    key: string;
    /** Short method name shared by every member. */
    method: string;
    /** Member method qualified names (`file::Class::method`), in input order. */
    members: string[];
    /** Short class names of the members, in the same order as `members`. */
    classNames: string[];
}

/** Short name from a qualified name (`file::Class::method` → `method`). */
function lastSegment(qualifiedName: string): string {
    return qualifiedName.split('::').pop() || qualifiedName;
}

/**
 * Partition `qns` into groups of interchangeable sibling-method implementations.
 *
 * Two method QNs are interchangeable when they share a method name AND their
 * declaring classes share a common base class (an INHERITS parent). Grouping on
 * the shared base — not merely the name — is what keeps this safe: two unrelated
 * `handle` functions never collapse, only genuine overrides of the same base
 * method do.
 *
 * Each QN is assigned to at most one group (its first INHERITS parent, chosen
 * deterministically). Only groups with ≥ 2 members present in `qns` are
 * returned; every other QN is a singleton the caller renders as before.
 */
export function groupInterchangeableImpls(
    qns: string[],
    edges: GraphEdge[],
): { groups: SiblingImplGroup[]; grouped: Set<string> } {
    // class QN → its INHERITS parents (base classes / interfaces).
    const parents = new Map<string, string[]>();
    for (const e of edges) {
        if (e.kind !== 'INHERITS') {
            continue;
        }
        const list = parents.get(e.source_qualified);
        if (list) {
            list.push(e.target_qualified);
        } else {
            parents.set(e.source_qualified, [e.target_qualified]);
        }
    }

    // Assign each method QN to exactly one group key (first parent + method).
    const byKey = new Map<string, string[]>();
    for (const qn of qns) {
        const parts = qn.split('::');
        if (parts.length < 3) {
            continue; // need file::Class::method
        }
        const method = parts[parts.length - 1];
        const className = parts.slice(0, -1).join('::');
        const ps = parents.get(className);
        if (!ps || ps.length === 0) {
            continue;
        }
        const key = `${ps[0]}::${method}`;
        const list = byKey.get(key);
        if (list) {
            list.push(qn);
        } else {
            byKey.set(key, [qn]);
        }
    }

    const groups: SiblingImplGroup[] = [];
    const grouped = new Set<string>();
    for (const [key, membersRaw] of byKey) {
        const members = [...new Set(membersRaw)];
        if (members.length < 2) {
            continue;
        }
        groups.push({
            key,
            method: lastSegment(key),
            members,
            // Class short-name = second-to-last segment of `file::Class::method`.
            classNames: members.map((m) => {
                const parts = m.split('::');
                return parts[parts.length - 2] ?? lastSegment(m);
            }),
        });
        for (const m of members) {
            grouped.add(m);
        }
    }
    return { groups, grouped };
}

/**
 * Render a collapsed sibling group's class list: up to `maxClasses` names, then
 * a "+k" remainder. e.g. `PaginatorA, PaginatorB, PaginatorC +2`.
 */
export function renderImplClasses(group: SiblingImplGroup, maxClasses = 3): string {
    const shown = group.classNames.slice(0, maxClasses).join(', ');
    const extra = group.classNames.length > maxClasses ? ` +${group.classNames.length - maxClasses}` : '';
    return `${shown}${extra}`;
}
