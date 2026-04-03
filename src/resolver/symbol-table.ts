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
  isUnique(name: string): boolean;
  lookupGlobal(name: string): string[];
  readonly size: number;
  readonly fileCount: number;
}

export function createSymbolTable(): SymbolTable {
  const byFile = new Map<string, Map<string, string>>();
  const byName = new Map<string, string[]>();

  return {
    add(file, name, qualified) {
      if (!byFile.has(file)) byFile.set(file, new Map());
      byFile.get(file)!.set(name, qualified);

      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(qualified);
    },

    lookupExact(file, name) {
      return byFile.get(file)?.get(name) ?? null;
    },

    isUnique(name) {
      return (byName.get(name)?.length ?? 0) === 1;
    },

    lookupGlobal(name) {
      return byName.get(name) ?? [];
    },

    get size() {
      let count = 0;
      for (const m of byFile.values()) count += m.size;
      return count;
    },

    get fileCount() {
      return byFile.size;
    },
  };
}
