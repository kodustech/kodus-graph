import { readdirSync } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { isSkippableFile, SKIP_DIRS } from '../shared/filters';
import { log } from '../shared/logger';
import { ensureWithinRoot } from '../shared/safe-path';
import { getLanguage } from './languages';

export interface DiscoverOptions {
    /**
     * Refuse to discover more than this many files. Guards against a runaway
     * walk on a giant monorepo. Applies only to the full-tree walk, never to an
     * explicit `filterFiles` list (the caller asked for those by name).
     */
    maxFiles?: number;
    /**
     * When the cap is exceeded, truncate to `maxFiles` and warn instead of
     * throwing. Off by default: a silently partial graph gives a review or
     * impact query a confidently wrong answer, so the cap fails loud unless the
     * caller explicitly opts into a partial build.
     */
    allowPartial?: boolean;
}

/**
 * Walk the filesystem and find all supported source files.
 * If `filterFiles` is provided, only return those specific files (resolved to absolute paths).
 * If `include` patterns are provided, keep only files matching at least one pattern.
 * If `exclude` patterns are provided, remove files matching any pattern.
 * If `opts.maxFiles` is set, a walk that discovers more than that throws unless
 * `opts.allowPartial` is set (then it truncates and warns).
 */
export function discoverFiles(
    repoDir: string,
    filterFiles?: string[],
    include?: string[],
    exclude?: string[],
    opts?: DiscoverOptions,
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

    if (opts?.maxFiles !== undefined && files.length > opts.maxFiles) {
        if (opts.allowPartial) {
            log.warn('Discovered files exceed --max-files; building a PARTIAL graph', {
                discovered: files.length,
                cap: opts.maxFiles,
                dropped: files.length - opts.maxFiles,
            });
            files = files.slice(0, opts.maxFiles);
        } else {
            throw new Error(
                `Discovered ${files.length} files, over the --max-files cap of ${opts.maxFiles}. ` +
                    'Raise --max-files, narrow the scan with --include/--exclude, or pass --allow-partial ' +
                    'to build a deliberately truncated graph. Refusing to silently drop files.',
            );
        }
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
