/**
 * TypeScript/JavaScript import resolver.
 *
 * Handles:
 * - Relative imports with extension probing (.ts, .tsx, .js, .jsx)
 * - ESM .js → .ts remapping
 * - Directory index files
 * - tsconfig path aliases
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { log } from '../../shared/logger';

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Probe a base path for TS/JS files: try extensions, then index files.
 * Returns the resolved absolute path or null.
 */
function probeExtensions(base: string): string | null {
    for (const ext of TS_EXTENSIONS) {
        const candidate = base + ext;
        if (existsSync(candidate)) {
            return resolvePath(candidate);
        }
    }
    for (const ext of TS_EXTENSIONS) {
        const candidate = join(base, `index${ext}`);
        if (existsSync(candidate)) {
            return resolvePath(candidate);
        }
    }
    return null;
}

/** Cache for parsed tsconfig.json (keyed by repoRoot). */
const tsconfigCache = new Map<string, { rootDirs?: string[] }>();

function loadTsconfigCompilerOptions(repoRoot: string): { rootDirs?: string[] } {
    const cached = tsconfigCache.get(repoRoot);
    if (cached !== undefined) return cached;

    const tsconfigPath = join(repoRoot, 'tsconfig.json');
    let result: { rootDirs?: string[] } = {};
    if (existsSync(tsconfigPath)) {
        try {
            const content = readFileSync(tsconfigPath, 'utf-8');
            const cleaned = stripJsonComments(content);
            const config = JSON.parse(cleaned);
            const rootDirs = config?.compilerOptions?.rootDirs;
            if (Array.isArray(rootDirs)) {
                result = { rootDirs };
            }
        } catch {
            // ignore parse errors
        }
    }
    tsconfigCache.set(repoRoot, result);
    return result;
}

/**
 * Resolve a TypeScript/JavaScript relative import to an absolute file path.
 * Returns null for non-relative (external package) imports.
 */
export function resolve(fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    // Strip Vite-style query suffixes (?raw, ?url, ?worker, etc.)
    const queryIdx = modulePath.indexOf('?');
    if (queryIdx !== -1) {
        modulePath = modulePath.slice(0, queryIdx);
    }

    if (!modulePath.startsWith('.')) {
        return null;
    }

    let base = join(dirname(fromAbsFile), modulePath);

    // If the path has a non-TS/JS extension (e.g. .txt, .svg), try exact match
    if (/\.\w+$/.test(modulePath) && !TS_EXTENSIONS.some(ext => modulePath.endsWith(ext))) {
        if (existsSync(base)) {
            return resolvePath(base);
        }
    }

    // ESM convention: .js in import -> .ts on disk
    if (modulePath.endsWith('.js')) {
        base = base.slice(0, -3);
    }

    const direct = probeExtensions(base);
    if (direct) return direct;

    // rootDirs fallback: try the same relative import from other root directories
    const { rootDirs } = loadTsconfigCompilerOptions(repoRoot);
    if (rootDirs && rootDirs.length > 0) {
        const fromDir = dirname(fromAbsFile);
        for (const rd of rootDirs) {
            const absRd = resolvePath(repoRoot, rd);
            // Check if fromDir is inside this rootDir
            if (fromDir.startsWith(absRd + '/') || fromDir === absRd) {
                const relFromRoot = fromDir.slice(absRd.length); // e.g. "" or "/sub"
                // Try the same relative path under each other rootDir
                for (const otherRd of rootDirs) {
                    if (otherRd === rd) continue;
                    const absOtherRd = resolvePath(repoRoot, otherRd);
                    const relModule = modulePath.startsWith('./') ? modulePath.slice(2) : modulePath;
                    let otherBase = join(absOtherRd, relFromRoot, relModule);
                    if (modulePath.endsWith('.js')) {
                        otherBase = otherBase.slice(0, -3);
                    }
                    const result = probeExtensions(otherBase);
                    if (result) return result;
                }
                break;
            }
        }
    }

    return null;
}

/**
 * Strip comments and trailing commas from JSON (tsconfig-compatible).
 * Handles strings correctly -- won't strip // inside "url://..." etc.
 */
function stripJsonComments(str: string): string {
    let result = '';
    let i = 0;
    const len = str.length;

    while (i < len) {
        // String literal -- copy as-is
        if (str[i] === '"') {
            let j = i + 1;
            while (j < len && str[j] !== '"') {
                if (str[j] === '\\') {
                    j++; // skip escaped char
                }
                j++;
            }
            result += str.substring(i, j + 1);
            i = j + 1;
            continue;
        }

        // Single-line comment
        if (str[i] === '/' && str[i + 1] === '/') {
            while (i < len && str[i] !== '\n') {
                i++;
            }
            continue;
        }

        // Block comment
        if (str[i] === '/' && str[i + 1] === '*') {
            i += 2;
            while (i < len && !(str[i] === '*' && str[i + 1] === '/')) {
                i++;
            }
            i += 2;
            continue;
        }

        // Trailing comma: comma followed by optional whitespace + closing bracket
        if (str[i] === ',') {
            let j = i + 1;
            while (j < len && (str[j] === ' ' || str[j] === '\t' || str[j] === '\n' || str[j] === '\r')) {
                j++;
            }
            if (str[j] === '}' || str[j] === ']') {
                i++;
                continue;
            }
        }

        result += str[i];
        i++;
    }

    return result;
}

/**
 * Load and parse tsconfig.json path aliases.
 *
 * Tries tsconfig.json first, then tsconfig.base.json.
 * Converts alias patterns like "@libs/*" into prefix → resolved dirs.
 */
export function loadTsconfigAliases(repoRoot: string): Map<string, string[]> {
    const aliases = new Map<string, string[]>();

    for (const filename of ['tsconfig.json', 'tsconfig.base.json']) {
        const tsconfigPath = join(repoRoot, filename);
        if (!existsSync(tsconfigPath)) {
            continue;
        }

        try {
            const content = readFileSync(tsconfigPath, 'utf-8');
            const cleaned = stripJsonComments(content);
            const config = JSON.parse(cleaned);
            const paths = config?.compilerOptions?.paths;
            const baseUrl = config?.compilerOptions?.baseUrl || '.';
            const baseDir = join(repoRoot, baseUrl);

            if (paths) {
                for (const [alias, targets] of Object.entries(paths)) {
                    // Convert alias pattern: "@libs/*" -> prefix "@libs/"
                    const prefix = alias.replace('/*', '/').replace('*', '');
                    const resolvedTargets = (targets as string[]).map((t) => {
                        const targetPath = t.replace('/*', '').replace('*', '');
                        return join(baseDir, targetPath);
                    });
                    aliases.set(prefix, resolvedTargets);
                }
            }
        } catch (err) {
            log.warn('Failed to parse tsconfig', { file: tsconfigPath, error: String(err) });
        }
    }

    return aliases;
}

/**
 * Resolve an import path using tsconfig aliases.
 *
 * Tries each alias prefix, and for matches, probes extensions and index files.
 */
export function resolveWithAliases(
    modulePath: string,
    aliases: Map<string, string[]>,
    _repoRoot: string,
): string | null {
    for (const [prefix, targets] of aliases) {
        if (modulePath.startsWith(prefix)) {
            const rest = modulePath.slice(prefix.length);

            for (const targetBase of targets) {
                const base = join(targetBase, rest);

                for (const ext of TS_EXTENSIONS) {
                    if (existsSync(base + ext)) {
                        return resolvePath(base + ext);
                    }
                }
                for (const ext of TS_EXTENSIONS) {
                    const idx = join(base, `index${ext}`);
                    if (existsSync(idx)) {
                        return resolvePath(idx);
                    }
                }
                // Try exact match (for directories with index)
                if (existsSync(base)) {
                    return resolvePath(base);
                }
            }
        }
    }

    return null;
}
