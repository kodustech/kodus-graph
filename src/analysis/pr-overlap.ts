/**
 * Pairwise overlap between two changesets (typically two open PRs).
 *
 * Two PRs can collide in two ways, and reviewers usually only see the first:
 *   - Direct collision: both changesets modify the *same symbol*. That is a
 *     merge conflict waiting to happen, and a semantic one even if git
 *     auto-merges the text.
 *   - Indirect coupling: one PR changes something the other PR's changed code
 *     *depends on* (its blast radius reaches into the other's edits), so they
 *     pass review independently and break once both land.
 *
 * This computes both from the graph, so a review tool can order PRs and warn
 * about pairs before they merge. It is deliberately pairwise and stateless: it
 * knows nothing about GitHub or which PRs are open — the caller lists the PRs
 * and pairs them; this answers "do these two collide, and how".
 */

import type { GraphData } from '../graph/types';
import { computeBlastRadius } from './blast-radius';
import { GraphIndex } from './graph-index';

export interface PrOverlapInput {
    /** Changed symbols (qualified names) for PR A. */
    changedA: string[];
    /** Changed symbols (qualified names) for PR B. */
    changedB: string[];
    maxDepth?: number;
    minConfidence?: number;
}

export type MergeRiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PrOverlapResult {
    a: { changed: number; blast_radius: number };
    b: { changed: number; blast_radius: number };
    /** Symbols BOTH PRs modify — a direct collision. */
    shared_changed: string[];
    /** B's changed symbols that fall inside A's blast radius (A's change reaches B's edits). */
    a_impacts_b: string[];
    /** A's changed symbols that fall inside B's blast radius (B's change reaches A's edits). */
    b_impacts_a: string[];
    /** Symbols reached by both blast radii — shared downstream territory. */
    shared_blast: string[];
    level: MergeRiskLevel;
    reason: string;
}

/** Flatten a blast-radius result into the set of impacted qualified names. */
function blastSet(
    graph: GraphData,
    seeds: string[],
    index: GraphIndex,
    maxDepth: number,
    minConf: number,
): Set<string> {
    const result = computeBlastRadius(graph, seeds, maxDepth, minConf, undefined, { index });
    const set = new Set<string>();
    for (const entries of Object.values(result.by_depth)) {
        for (const e of entries) {
            set.add(e.qualified_name);
        }
    }
    return set;
}

export function computePrOverlap(graph: GraphData, input: PrOverlapInput): PrOverlapResult {
    const maxDepth = input.maxDepth ?? 3;
    const minConf = input.minConfidence ?? 0.5;
    const index = new GraphIndex(graph);

    const changedA = new Set(input.changedA);
    const changedB = new Set(input.changedB);

    const blastA = blastSet(graph, input.changedA, index, maxDepth, minConf);
    const blastB = blastSet(graph, input.changedB, index, maxDepth, minConf);

    // Direct collision: both modify the same symbol.
    const shared_changed = [...changedA].filter((q) => changedB.has(q)).sort();

    // Indirect coupling: one PR's blast radius reaches the other's edits. Exclude
    // the direct collisions so each pair of symbols is reported once, at its
    // strongest relationship.
    const a_impacts_b = [...blastA].filter((q) => changedB.has(q) && !changedA.has(q)).sort();
    const b_impacts_a = [...blastB].filter((q) => changedA.has(q) && !changedB.has(q)).sort();

    // Shared downstream: both blasts hit the same node (neither PR edits it, but
    // both perturb it).
    const shared_blast = [...blastA].filter((q) => blastB.has(q) && !changedA.has(q) && !changedB.has(q)).sort();

    let level: MergeRiskLevel;
    let reason: string;
    if (shared_changed.length > 0) {
        level = 'HIGH';
        reason = `both PRs modify ${shared_changed.length} shared symbol(s)`;
    } else if (a_impacts_b.length > 0 || b_impacts_a.length > 0) {
        level = 'MEDIUM';
        reason = "one PR's change reaches code the other PR edits";
    } else if (shared_blast.length > 0) {
        level = 'LOW';
        reason = `${shared_blast.length} shared downstream symbol(s), no direct overlap`;
    } else {
        level = 'LOW';
        reason = 'isolated — no shared symbols or impact';
    }

    return {
        a: { changed: changedA.size, blast_radius: blastA.size },
        b: { changed: changedB.size, blast_radius: blastB.size },
        shared_changed,
        a_impacts_b,
        b_impacts_a,
        shared_blast,
        level,
        reason,
    };
}

/**
 * Expand a list of changed files into the qualified names of every symbol those
 * files declare. A convenience for callers that only know which files a PR
 * touched, not which symbols — coarser than passing changed symbols directly
 * (it treats the whole file as changed), so prefer symbol-level input when the
 * caller has a diff.
 */
export function symbolsInFiles(graph: GraphData, files: string[]): string[] {
    const fileSet = new Set(files);
    const out: string[] = [];
    for (const node of graph.nodes) {
        if (fileSet.has(node.file_path)) {
            out.push(node.qualified_name);
        }
    }
    return out;
}
