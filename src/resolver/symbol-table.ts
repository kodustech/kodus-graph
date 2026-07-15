/**
 * Symbol table with dual-index lookup (GitNexus pattern).
 *
 * Provides both exact (file + name) and global (name-only) lookups.
 * The exact lookup is high-confidence; global lookup is lower-confidence
 * but useful when import resolution fails.
 */

import type { GraphNode } from '../graph/types';

export interface SymbolTable {
    add(file: string, name: string, qualified: string): void;
    lookupExact(file: string, name: string): string | null;
    lookupInFile(file: string, name: string, className: string): string | null;
    isUnique(name: string): boolean;
    lookupGlobal(name: string): string[];
    /**
     * Number of distinct files that declare a symbol with this name.
     * Used by the resolver to decide if a name is "codebase-ambiguous" without
     * relying on a hardcoded blacklist.
     */
    countDefinitions(name: string): number;
    /**
     * Total distinct files represented in the global index. Used by the
     * resolver to scale the codebase-ambiguous threshold proportionally to
     * repo size.
     */
    totalIndexedFiles(): number;
    readonly size: number;
    readonly fileCount: number;
}

export function createSymbolTable(): SymbolTable {
    const byFile = new Map<string, Map<string, string[]>>();
    const byName = new Map<string, string[]>();

    return {
        add(file, name, qualified) {
            if (!byFile.has(file)) {
                byFile.set(file, new Map());
            }
            const fileMap = byFile.get(file)!;
            if (!fileMap.has(name)) {
                fileMap.set(name, []);
            }
            fileMap.get(name)!.push(qualified);

            if (!byName.has(name)) {
                byName.set(name, []);
            }
            byName.get(name)!.push(qualified);
        },

        lookupExact(file, name) {
            const candidates = byFile.get(file)?.get(name);
            if (!candidates || candidates.length === 0) {
                return null;
            }
            // Only return if unambiguous within this file
            return candidates.length === 1 ? candidates[0] : null;
        },

        lookupInFile(file, name, className) {
            const candidates = byFile.get(file)?.get(name);
            if (!candidates || candidates.length === 0) {
                return null;
            }
            return candidates.find((q) => q.includes(`::${className}.${name}`)) ?? null;
        },

        isUnique(name) {
            return (byName.get(name)?.length ?? 0) === 1;
        },

        lookupGlobal(name) {
            return byName.get(name) ?? [];
        },

        countDefinitions(name) {
            const candidates = byName.get(name);
            if (!candidates || candidates.length === 0) {
                return 0;
            }
            const files = new Set<string>();
            for (const q of candidates) {
                const file = q.includes('::') ? q.split('::')[0] : q;
                files.add(file);
            }
            return files.size;
        },

        totalIndexedFiles() {
            // byFile is the canonical per-file index; its size matches the
            // notion of "file" used by countDefinitions (the left side of
            // `file::qualified`).
            return byFile.size;
        },

        get size() {
            let count = 0;
            for (const m of byFile.values()) {
                for (const arr of m.values()) {
                    count += arr.length;
                }
            }
            return count;
        },

        get fileCount() {
            return byFile.size;
        },
    };
}

/**
 * Symbol-bearing node kinds. `Test` is excluded — tests aren't callable targets.
 */
const SYMBOL_KINDS = new Set(['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Enum']);

/**
 * Widen a slice-built symbol table with the symbols of every baseline file that
 * the slice did not re-parse.
 *
 * A slice-only table is not merely incomplete, it is actively misleading. The
 * resolver's ambiguity checks are population statistics: `isUnique(name)` and
 * `countDefinitions(name) >= max(15, totalIndexedFiles() * 0.02)` both ask "how
 * common is this name in the codebase?". Ask that of a two-file table and every
 * name looks unique. A call that `parse --all` correctly resolves at the
 * ambiguous tier (0.30, discarded by the default `--min-confidence 0.5`) is
 * instead promoted to the unique tier (0.60) and shipped — pointing at whichever
 * definition happened to be in the slice.
 *
 * Observed on a fixture with `handleError` defined in three files:
 *
 *     parse --all:  caller.ts::run -> mod2.ts::handleError  0.30  ambiguous
 *     update:       caller.ts::run -> mod1.ts::handleError  0.60  unique
 *
 * Different target, double the confidence, and above the threshold that would
 * have dropped it — from the same repository, differing only in which command
 * built the graph.
 *
 * The slice's fresh extraction owns the symbols of files it parsed; the baseline
 * only fills in the rest, so a symbol deleted in the slice does not come back.
 */
export function seedSymbolTableFromBaseline(
    symbolTable: SymbolTable,
    baselineNodes: readonly GraphNode[],
    sliceFiles: ReadonlySet<string>,
): number {
    let seeded = 0;
    for (const node of baselineNodes) {
        if (sliceFiles.has(node.file_path)) {
            continue;
        }
        if (!SYMBOL_KINDS.has(node.kind)) {
            continue;
        }
        symbolTable.add(node.file_path, node.name, node.qualified_name);
        seeded++;
    }
    return seeded;
}
