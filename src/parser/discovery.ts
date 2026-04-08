import { readdirSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { isSkippableFile, SKIP_DIRS } from '../shared/filters';
import { log } from '../shared/logger';
import { ensureWithinRoot } from '../shared/safe-path';
import { getLanguage } from './languages';

/**
 * Walk the filesystem and find all supported source files.
 * If `filterFiles` is provided, only return those specific files (resolved to absolute paths).
 * If `include` patterns are provided, keep only files matching at least one pattern.
 * If `exclude` patterns are provided, remove files matching any pattern.
 */
export function discoverFiles(
    repoDir: string,
    filterFiles?: string[],
    include?: string[],
    exclude?: string[],
): string[] {
    const absRepoDir = resolve(repoDir);

    if (filterFiles) {
        return filterFiles
            .map((f) => (f.startsWith('/') ? f : join(absRepoDir, f)))
            .filter((f) => {
                try {
                    ensureWithinRoot(f, absRepoDir);
                    return getLanguage(extname(f)) !== null;
                } catch (err) {
                    log.warn('Skipping file outside repository root', { file: f, error: String(err) });
                    return false;
                }
            });
    }

    let files: string[] = [];
    walkFiles(absRepoDir, files);

    // Apply include/exclude filters using Bun.Glob
    const hasInclude = include && include.length > 0;
    const hasExclude = exclude && exclude.length > 0;

    if (hasInclude || hasExclude) {
        const includeGlobs = hasInclude ? include.map((p) => new Bun.Glob(p)) : null;
        const excludeGlobs = hasExclude ? exclude.map((p) => new Bun.Glob(p)) : null;

        files = files.filter((absPath) => {
            const rel = relative(absRepoDir, absPath);

            // If include patterns exist, file must match at least one
            if (includeGlobs && !includeGlobs.some((g) => g.match(rel))) {
                return false;
            }

            // If exclude patterns exist, file must not match any
            if (excludeGlobs?.some((g) => g.match(rel))) {
                return false;
            }

            return true;
        });
    }

    return files;
}

function walkFiles(dir: string, files: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
            walkFiles(join(dir, entry.name), files);
        } else if (entry.isFile() && getLanguage(extname(entry.name)) !== null && !isSkippableFile(entry.name)) {
            files.push(join(dir, entry.name));
        }
    }
}
