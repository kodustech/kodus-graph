/**
 * Symbol table with dual-index lookup (GitNexus pattern).
 *
 * Provides both exact (file + name) and global (name-only) lookups.
 * The exact lookup is high-confidence; global lookup is lower-confidence
 * but useful when import resolution fails.
 */

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
