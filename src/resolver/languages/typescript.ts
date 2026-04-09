/**
 * TypeScript/JavaScript import resolver.
 *
 * Handles:
 * - Relative imports with extension probing (.ts, .tsx, .js, .jsx)
 * - ESM .js → .ts remapping
 * - Directory index files
 * - tsconfig path aliases
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { log } from '../../shared/logger';
import { cachedExists } from '../fs-cache';

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Probe a base path for TS/JS files: try extensions, then index files.
 * Returns the resolved absolute path or null.
 */
function probeExtensions(base: string): string | null {
    for (const ext of TS_EXTENSIONS) {
        const candidate = base + ext;
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }
    for (const ext of TS_EXTENSIONS) {
        const candidate = join(base, `index${ext}`);
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }
    return null;
}

/** Cache for parsed tsconfig.json (keyed by repoRoot). */
const tsconfigCache = new Map<string, { rootDirs?: string[] }>();

/** Cache for parsed bundler aliases (keyed by repoRoot). */
const bundlerAliasCache = new Map<string, Map<string, string[]>>();

/**
 * Load aliases from webpack.config.ts/js and vite.config.ts/js.
 * These are NOT in tsconfig — many large projects use bundler aliases instead.
 *
 * Parses simple alias patterns from resolve.alias blocks.
 * Returns Map<prefix, absoluteDir> — same format as tsconfig aliases.
 */
export function loadBundlerAliases(repoRoot: string): Map<string, string[]> {
    const cached = bundlerAliasCache.get(repoRoot);
    if (cached !== undefined) {
        return cached;
    }

    const aliases = new Map<string, string[]>();

    const configFiles = [
        'webpack.config.js',
        'webpack.config.ts',
        'vite.config.js',
        'vite.config.ts',
    ];

    for (const configFile of configFiles) {
        const configPath = join(repoRoot, configFile);
        if (!cachedExists(configPath)) {
            continue;
        }

        try {
            const content = readFileSync(configPath, 'utf-8');
            parseBundlerAliases(content, repoRoot, aliases);
        } catch {
            // config file read failed, continue
        }
    }

    bundlerAliasCache.set(repoRoot, aliases);
    return aliases;
}

/**
 * Parse alias definitions from a webpack or vite config file content.
 * Handles:
 * - path.join(__dirname, 'a', 'b') and path.resolve(__dirname, 'a', 'b')
 * - Simple string literal values: 'key': '/path/to/dir'
 * - Variable references like path.join(varName, 'sub') where varName is defined
 *   earlier as const varName = path.join(__dirname, ...)
 */
function parseBundlerAliases(
    content: string,
    repoRoot: string,
    aliases: Map<string, string[]>,
): void {
    // First, extract top-level variable definitions like:
    //   const staticPrefix = path.join(__dirname, 'static')
    const varDefs = new Map<string, string>();
    const varDefRegex = /(?:const|let|var)\s+(\w+)\s*=\s*path\.(?:join|resolve)\s*\(\s*__dirname\s*,\s*([^)]+)\)/g;
    let varMatch = varDefRegex.exec(content);
    while (varMatch !== null) {
        const varName = varMatch[1];
        const argsStr = varMatch[2];
        const segments = extractStringArgs(argsStr);
        if (segments.length > 0) {
            varDefs.set(varName, join(repoRoot, ...segments));
        }
        varMatch = varDefRegex.exec(content);
    }

    // Find the alias block — look for alias: { ... } or alias: [ ... ]
    // We search for "alias:" or "alias :" possibly inside resolve: { ... }
    const aliasBlockRegex = /alias\s*:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
    let aliasMatch = aliasBlockRegex.exec(content);

    while (aliasMatch !== null) {
        const aliasBlock = aliasMatch[1];
        parseAliasEntries(aliasBlock, repoRoot, varDefs, aliases);
        aliasMatch = aliasBlockRegex.exec(content);
    }
}

/**
 * Parse individual alias entries from inside an alias block.
 */
function parseAliasEntries(
    block: string,
    repoRoot: string,
    varDefs: Map<string, string>,
    aliases: Map<string, string[]>,
): void {
    // Match entries like:
    //   key: path.join(__dirname, 'a', 'b'),
    //   'key': path.join(__dirname, 'a', 'b'),
    //   "key": path.resolve(__dirname, 'a'),
    //   key: path.join(varName, 'sub'),
    //   key: 'literal/path',
    //   'key': 'literal/path',

    // Pattern for key (unquoted identifier or quoted string)
    const keyPattern = /(?:'([^']+)'|"([^"]+)"|(\w+))\s*:\s*/g;

    let keyMatch = keyPattern.exec(block);
    while (keyMatch !== null) {
        const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
        const valueStart = keyMatch.index + keyMatch[0].length;
        const restOfBlock = block.slice(valueStart);

        const resolvedDir = resolveAliasValue(restOfBlock, repoRoot, varDefs);

        if (resolvedDir !== null && !aliases.has(key + '/') && !aliases.has(key)) {
            // Use key + '/' as prefix for path-based aliases (like tsconfig aliases)
            // but if the key already ends with special chars like ~, use as-is
            const prefix = key.endsWith('/') ? key : key + '/';
            aliases.set(prefix, [resolvedDir]);
            // Also set exact match (for bare imports like 'sentry' → 'sentry/')
            if (!aliases.has(key) && key !== prefix) {
                aliases.set(key, [resolvedDir]);
            }
        }

        keyMatch = keyPattern.exec(block);
    }
}

/**
 * Try to resolve an alias value expression to an absolute directory.
 */
function resolveAliasValue(
    expr: string,
    repoRoot: string,
    varDefs: Map<string, string>,
): string | null {
    // path.join(__dirname, 'a', 'b') or path.resolve(__dirname, 'a', 'b')
    const pathDirnameRegex = /^path\.(?:join|resolve)\s*\(\s*__dirname\s*,\s*([^)]+)\)/;
    const dirnameMatch = pathDirnameRegex.exec(expr);
    if (dirnameMatch) {
        const segments = extractStringArgs(dirnameMatch[1]);
        if (segments.length > 0) {
            return join(repoRoot, ...segments);
        }
    }

    // path.join(varName, 'a', 'b') or path.resolve(varName, 'a')
    const pathVarRegex = /^path\.(?:join|resolve)\s*\(\s*(\w+)\s*(?:,\s*([^)]+))?\)/;
    const varMatch = pathVarRegex.exec(expr);
    if (varMatch) {
        const varName = varMatch[1];
        if (varName !== '__dirname' && varDefs.has(varName)) {
            const baseDir = varDefs.get(varName)!;
            if (varMatch[2]) {
                const segments = extractStringArgs(varMatch[2]);
                if (segments.length > 0) {
                    return join(baseDir, ...segments);
                }
            }
            return baseDir;
        }
    }

    // Simple string literal: 'path/to/dir' or "path/to/dir"
    const stringLiteralRegex = /^['"]([^'"]+)['"]/;
    const strMatch = stringLiteralRegex.exec(expr);
    if (strMatch) {
        return join(repoRoot, strMatch[1]);
    }

    return null;
}

/**
 * Extract string literal arguments from a comma-separated argument list.
 * e.g. "'static', 'app'" → ['static', 'app']
 */
function extractStringArgs(argsStr: string): string[] {
    const segments: string[] = [];
    const argRegex = /['"]([^'"]+)['"]/g;
    let m = argRegex.exec(argsStr);
    while (m !== null) {
        segments.push(m[1]);
        m = argRegex.exec(argsStr);
    }
    return segments;
}

function loadTsconfigCompilerOptions(repoRoot: string): { rootDirs?: string[] } {
    const cached = tsconfigCache.get(repoRoot);
    if (cached !== undefined) {
        return cached;
    }

    const tsconfigPath = join(repoRoot, 'tsconfig.json');
    let result: { rootDirs?: string[] } = {};
    if (cachedExists(tsconfigPath)) {
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
    if (/\.\w+$/.test(modulePath) && !TS_EXTENSIONS.some((ext) => modulePath.endsWith(ext))) {
        if (cachedExists(base)) {
            return resolvePath(base);
        }
    }

    // ESM convention: .js in import -> .ts on disk
    if (modulePath.endsWith('.js')) {
        base = base.slice(0, -3);
    }

    const direct = probeExtensions(base);
    if (direct) {
        return direct;
    }

    // rootDirs fallback: try the same relative import from other root directories
    const { rootDirs } = loadTsconfigCompilerOptions(repoRoot);
    if (rootDirs && rootDirs.length > 0) {
        const fromDir = dirname(fromAbsFile);
        for (const rd of rootDirs) {
            const absRd = resolvePath(repoRoot, rd);
            // Check if fromDir is inside this rootDir
            if (fromDir.startsWith(`${absRd}/`) || fromDir === absRd) {
                const relFromRoot = fromDir.slice(absRd.length); // e.g. "" or "/sub"
                // Try the same relative path under each other rootDir
                for (const otherRd of rootDirs) {
                    if (otherRd === rd) {
                        continue;
                    }
                    const absOtherRd = resolvePath(repoRoot, otherRd);
                    const relModule = modulePath.startsWith('./') ? modulePath.slice(2) : modulePath;
                    let otherBase = join(absOtherRd, relFromRoot, relModule);
                    if (modulePath.endsWith('.js')) {
                        otherBase = otherBase.slice(0, -3);
                    }
                    const result = probeExtensions(otherBase);
                    if (result) {
                        return result;
                    }
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

    loadTsconfigPathsInto(repoRoot, aliases);

    return aliases;
}

/**
 * Parse a tsconfig.json (and tsconfig.base.json) in the given directory
 * and add its path aliases to the provided map.
 */
function loadTsconfigPathsInto(
    dir: string,
    aliases: Map<string, string[]>,
    visited?: Set<string>,
): void {
    const seen = visited ?? new Set<string>();
    const absDir = resolvePath(dir);
    if (seen.has(absDir)) {
        return;
    }
    seen.add(absDir);

    for (const filename of ['tsconfig.json', 'tsconfig.base.json']) {
        const tsconfigPath = join(dir, filename);
        if (!cachedExists(tsconfigPath)) {
            continue;
        }

        try {
            const content = readFileSync(tsconfigPath, 'utf-8');
            const cleaned = stripJsonComments(content);
            const config = JSON.parse(cleaned);
            const paths = config?.compilerOptions?.paths;
            const baseUrl = config?.compilerOptions?.baseUrl || '.';
            const baseDir = join(dir, baseUrl);

            if (paths) {
                for (const [alias, targets] of Object.entries(paths)) {
                    // Convert alias pattern: "@libs/*" -> prefix "@libs/"
                    const prefix = alias.replace('/*', '/').replace('*', '');
                    if (!aliases.has(prefix)) {
                        const resolvedTargets = (targets as string[]).map((t) => {
                            const targetPath = t.replace('/*', '').replace('*', '');
                            return join(baseDir, targetPath);
                        });
                        aliases.set(prefix, resolvedTargets);
                    }
                }
            }

            // Follow project references to discover aliases from referenced projects
            const references = config?.references;
            if (Array.isArray(references)) {
                for (const ref of references) {
                    if (ref && typeof ref.path === 'string') {
                        const refDir = resolvePath(dir, ref.path);
                        if (cachedExists(refDir)) {
                            loadTsconfigPathsInto(refDir, aliases, seen);
                        }
                    }
                }
            }
        } catch (err) {
            log.warn('Failed to parse tsconfig', { file: tsconfigPath, error: String(err) });
        }
    }
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
                    if (cachedExists(base + ext)) {
                        return resolvePath(base + ext);
                    }
                }
                for (const ext of TS_EXTENSIONS) {
                    const idx = join(base, `index${ext}`);
                    if (cachedExists(idx)) {
                        return resolvePath(idx);
                    }
                }
                // Try exact match (for directories with index)
                if (cachedExists(base)) {
                    return resolvePath(base);
                }
            }
        }
    }

    return null;
}
