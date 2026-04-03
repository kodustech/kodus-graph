import { readdirSync } from 'fs';
import { join, extname, resolve } from 'path';
import { SKIP_DIRS } from '../shared/filters';
import { getLanguage } from './languages';
import { ensureWithinRoot } from '../shared/safe-path';
import { log } from '../shared/logger';

/**
 * Walk the filesystem and find all supported source files.
 * If `filterFiles` is provided, only return those specific files (resolved to absolute paths).
 */
export function discoverFiles(repoDir: string, filterFiles?: string[]): string[] {
  const absRepoDir = resolve(repoDir);

  if (filterFiles) {
    return filterFiles
      .map(f => f.startsWith('/') ? f : join(absRepoDir, f))
      .filter(f => {
        try {
          ensureWithinRoot(f, absRepoDir);
          return getLanguage(extname(f)) !== null;
        } catch (err) {
          log.warn('Skipping file outside repository root', { file: f, error: String(err) });
          return false;
        }
      });
  }

  const files: string[] = [];
  walkFiles(absRepoDir, files);
  return files;
}

function walkFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      walkFiles(join(dir, entry.name), files);
    } else if (entry.isFile() && getLanguage(extname(entry.name)) !== null) {
      files.push(join(dir, entry.name));
    }
  }
}
