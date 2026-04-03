/**
 * Import map: tracks which symbols are imported from where per file.
 *
 * For each importing file, maps symbol names to the resolved file path
 * they were imported from. Used by the call resolver to connect
 * function calls to their definitions across files.
 */

export interface ImportMap {
  add(file: string, name: string, targetFile: string): void;
  lookup(file: string, name: string): string | null;
}

export function createImportMap(): ImportMap {
  const map = new Map<string, Map<string, string>>();

  return {
    add(file, name, targetFile) {
      if (!map.has(file)) map.set(file, new Map());
      map.get(file)!.set(name, targetFile);
    },

    lookup(file, name) {
      return map.get(file)?.get(name) ?? null;
    },
  };
}
