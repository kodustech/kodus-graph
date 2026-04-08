/**
 * Re-export (barrel) resolver.
 *
 * Follows `export { X } from './module'` chains so that the import map
 * points to the file where the symbol is actually defined, not the
 * barrel index file.
 *
 * Without this, an import like `import { Foo } from '@lib'` resolves
 * to `@lib/index.ts`, but `Foo` is defined in `@lib/foo.ts`.
 * The call resolver can't find `Foo` in the barrel's symbol table and
 * falls to lower-confidence tiers.
 */

import { relative, resolve } from 'path';
import { resolveImport } from './import-resolver';

interface RawReExport {
  module: string;
  file: string;
  line: number;
}

/**
 * Build a map: barrel file (relative) → list of resolved re-export target files (relative).
 *
 * Follows one level of re-exports (covers >95% of real-world barrel patterns).
 */
export function buildReExportMap(
  reExports: RawReExport[],
  repoDir: string,
  tsconfigAliases?: Map<string, string[]>,
): Map<string, string[]> {
  const barrelMap = new Map<string, string[]>();

  for (const re of reExports) {
    const absFrom = resolve(repoDir, re.file);
    const resolved = resolveImport(absFrom, re.module, 'typescript', repoDir, tsconfigAliases);
    if (!resolved) continue;

    const resolvedRel = relative(repoDir, resolved);
    const list = barrelMap.get(re.file);
    if (list) {
      if (!list.includes(resolvedRel)) list.push(resolvedRel);
    } else {
      barrelMap.set(re.file, [resolvedRel]);
    }
  }

  // Follow one extra level: if a re-export target is itself a barrel, flatten
  for (const [barrel, targets] of barrelMap) {
    const extra: string[] = [];
    for (const target of targets) {
      const nested = barrelMap.get(target);
      if (nested) {
        for (const n of nested) {
          if (n !== barrel && !targets.includes(n) && !extra.includes(n)) {
            extra.push(n);
          }
        }
      }
    }
    if (extra.length > 0) targets.push(...extra);
  }

  return barrelMap;
}
