/**
 * Staleness check — "is this graph still true?".
 *
 * A graph queried after the code moved on answers confidently and wrongly, which
 * is worse than grep's honest miss. This compares the file hash stored on each
 * node against the file on disk now, so a consumer can tell whether the graph is
 * safe to trust or needs `update` first.
 *
 * Scope: it detects files the graph knows that have changed or been deleted. It
 * does NOT detect brand-new files (those require a discovery pass); `up_to_date`
 * therefore means "nothing the graph covers has drifted", not "the graph covers
 * everything on disk".
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import type { IndexedGraph } from '../graph/loader';
import { computeFileHash } from '../shared/file-hash';

export interface StatusInput {
    /** Repo root the graph's relative file paths resolve against. */
    repoDir: string;
}

export interface StatusResult {
    total_files: number;
    fresh: number;
    /** Files whose content hash changed since the graph was built. */
    stale: string[];
    /** Files the graph references that no longer exist on disk. */
    deleted: string[];
    /** Files the graph recorded without a hash — cannot be checked. */
    unknown: string[];
    /** True when nothing the graph covers has drifted. */
    up_to_date: boolean;
}

export function computeStatus(graph: IndexedGraph, input: StatusInput): StatusResult {
    // One stored hash per file (every node in a file shares its file_hash).
    const fileHashes = new Map<string, string | undefined>();
    for (const node of graph.nodes) {
        if (!fileHashes.has(node.file_path)) {
            fileHashes.set(node.file_path, (node as { file_hash?: string }).file_hash);
        }
    }

    const stale: string[] = [];
    const deleted: string[] = [];
    const unknown: string[] = [];
    let fresh = 0;

    for (const [file, storedHash] of fileHashes) {
        if (!storedHash) {
            unknown.push(file);
            continue;
        }
        const abs = resolve(input.repoDir, file);
        if (!existsSync(abs)) {
            deleted.push(file);
            continue;
        }
        if (computeFileHash(abs) === storedHash) {
            fresh++;
        } else {
            stale.push(file);
        }
    }

    stale.sort();
    deleted.sort();
    unknown.sort();

    return {
        total_files: fileHashes.size,
        fresh,
        stale,
        deleted,
        unknown,
        up_to_date: stale.length === 0 && deleted.length === 0,
    };
}
