import { execFileSync } from 'child_process';
import { existsSync, lstatSync, readdirSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';
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
    /**
     * Inside a git work tree, skip paths git ignores (`.gitignore`, nested ignore
     * files, `.git/info/exclude`, `core.excludesFile`). Default true. Set false
     * (`parse --no-gitignore`) to also read ignored paths, e.g. generated code a
     * team deliberately keeps out of git but wants in the graph.
     */
    respectGitignore?: boolean;
    /**
     * Filled in with the strategy that actually produced the file list, which
     * can differ from what `respectGitignore` asked for: outside a work tree, or
     * when git fails, discovery falls back to the walk and ignored paths are
     * included. Callers that persist discovery settings must record this, not
     * the request. Left untouched for an explicit `filterFiles` list.
     */
    report?: { strategy?: 'git' | 'walk' };
}

/**
 * Find all supported source files. Inside a git work tree the list comes from
 * git, so ignored paths are skipped (unless `opts.respectGitignore` is false);
 * otherwise the filesystem is walked.
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
    const wantGit = opts?.respectGitignore !== false;
    const fromGit = wantGit ? listGitFiles(absRepoDir) : null;
    if (fromGit) {
        files = fromGit;
        log.debug('discovered files via git ls-files', { files: files.length });
    } else {
        // Not a git work tree, git unavailable, --repo-dir is itself ignored by an
        // enclosing repo, or gitignore handling is off: plain walk.
        walkFiles(absRepoDir, files);
        log.debug('discovered files via filesystem walk', { files: files.length });
        if (wantGit && insideGitCheckout(absRepoDir) && !isIgnoredDir(absRepoDir)) {
            // A checkout git can't list (missing binary, "dubious ownership" on a
            // CI/Docker mount, …): ignored paths are in this file set.
            log.warn(
                'git could not list files in this checkout; walked the filesystem, so git-ignored paths are included',
                {
                    repoDir: absRepoDir,
                },
            );
        }
    }
    if (opts?.report) {
        opts.report.strategy = fromGit ? 'git' : 'walk';
    }

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

/**
 * List source files through git so `.gitignore` is honoured exactly as git
 * does it (nested ignore files, `.git/info/exclude`, `core.excludesFile`):
 * tracked files plus untracked-but-not-ignored ones. The same SKIP_DIRS and
 * skippable-file filters as the walk still apply, so a committed `dist/` stays
 * out. Returns null — and the caller falls back to the plain walk — when
 * `absRepoDir` isn't inside a git work tree, git is unavailable, or `absRepoDir`
 * itself is ignored by an enclosing repo (the caller pointed at it explicitly;
 * honouring the parent's ignore rule would silently return nothing).
 */
function listGitFiles(absRepoDir: string): string[] | null {
    let out: string;
    try {
        out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
            cwd: absRepoDir,
            encoding: 'utf-8',
            maxBuffer: 512 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return null;
    }

    if (out === '' && isIgnoredDir(absRepoDir)) {
        return null;
    }

    const files: string[] = [];
    for (const rel of out.split('\0')) {
        if (!rel) {
            continue;
        }
        const segments = rel.split('/');
        if (segments.slice(0, -1).some((s) => SKIP_DIRS.has(s))) {
            continue;
        }
        const abs = join(absRepoDir, rel);
        let stat: ReturnType<typeof lstatSync>;
        try {
            stat = lstatSync(abs);
        } catch {
            continue; // tracked in the index but deleted from the working tree
        }
        if (stat.isDirectory()) {
            // A submodule shows up as a single gitlink entry. List it through its
            // own git so its .gitignore applies too; walk it if it isn't checked out.
            const inner = listGitFiles(abs);
            if (inner) {
                files.push(...inner);
            } else {
                walkFiles(abs, files);
            }
            continue;
        }
        const name = segments[segments.length - 1];
        if (stat.isFile() && getLanguage(extname(name)) !== null && !isSkippableFile(name)) {
            files.push(abs);
        }
    }
    return files;
}

/** True when `absDir` or an ancestor holds a `.git` entry (dir, or file for worktrees/submodules). */
function insideGitCheckout(absDir: string): boolean {
    for (let dir = absDir; ; dir = dirname(dir)) {
        if (existsSync(join(dir, '.git'))) {
            return true;
        }
        if (dirname(dir) === dir) {
            return false;
        }
    }
}

function isIgnoredDir(absDir: string): boolean {
    try {
        execFileSync('git', ['check-ignore', '-q', '.'], { cwd: absDir, stdio: 'ignore' });
        return true; // exit 0: ignored
    } catch {
        return false; // exit 1: not ignored (or git error — keep git's empty answer)
    }
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
