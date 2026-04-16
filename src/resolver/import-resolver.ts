/**
 * Import resolver dispatcher.
 *
 * Routes import resolution to language-specific resolvers and
 * falls back to tsconfig aliases for TypeScript/JavaScript.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { resolve as resolveCImport } from '../languages/c/resolver';
import { resolve as resolveCsImport } from '../languages/csharp/resolver';
import { resolve as resolveDartImport } from '../languages/dart/resolver';
import { resolve as resolveElixirImport } from '../languages/elixir/resolver';
import { resolve as resolveGoImport } from '../languages/go/resolver';
import { resolve as resolveJavaImport } from '../languages/java/resolver';
import { resolve as resolvePhpImport } from '../languages/php/resolver';
import { resolve as resolvePyImport } from '../languages/python/resolver';
import { resolve as resolveRbImport } from '../languages/ruby/resolver';
import { resolve as resolveRustImport } from '../languages/rust/resolver';
import { resolve as resolveSwiftImport } from '../languages/swift/resolver';
import {
    loadBundlerAliases,
    loadTsconfigAliases,
    resolve as resolveTsImport,
    resolveWithAliases,
} from '../languages/typescript/resolver';
import { log } from '../shared/logger';
import { ensureWithinRoot } from '../shared/safe-path';
import { detectExternal } from './external-detector';
import { cachedExists } from './fs-cache';

/**
 * Registered import resolvers by language key.
 *
 * IMPORTANT: When adding a new language, you MUST:
 * 1. Create a resolver in src/languages/<lang>/resolver.ts
 * 2. Add it to this map
 * 3. Add tests in tests/resolver/<lang>.test.ts
 * 4. Add external detection in src/languages/<lang>/external.ts
 *
 * If a language key from the parser is not in this map, resolveImport()
 * will log a warning and return null. This is intentional — silent
 * failures that default to another language's resolver cause wrong results.
 */
const RESOLVERS: Record<string, (from: string, mod: string, root: string) => string | null> = {
    ts: resolveTsImport,
    javascript: resolveTsImport,
    typescript: resolveTsImport,
    python: resolvePyImport,
    ruby: resolveRbImport,
    go: resolveGoImport,
    java: resolveJavaImport,
    kotlin: resolveJavaImport,
    scala: resolveJavaImport,
    rust: resolveRustImport,
    csharp: resolveCsImport,
    php: resolvePhpImport,
    swift: resolveSwiftImport,
    dart: resolveDartImport,
    c: resolveCImport,
    cpp: resolveCImport,
    elixir: resolveElixirImport,
};

/**
 * Resolve package.json #imports (Node.js subpath imports).
 * Handles both exact matches and wildcard patterns.
 */
function resolveHashImport(modulePath: string, repoRoot: string): string | null {
    const pkgPath = join(repoRoot, 'package.json');
    if (!cachedExists(pkgPath)) {
        return null;
    }

    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const imports = pkg?.imports;
        if (!imports) {
            return null;
        }

        for (const [pattern, target] of Object.entries(imports)) {
            if (typeof target !== 'string') {
                continue;
            }

            if (pattern === modulePath) {
                // Exact match: "#utils" -> "./src/shared/utils.ts"
                const resolved = resolvePath(repoRoot, target);
                if (cachedExists(resolved)) {
                    return resolved;
                }
            }

            // Wildcard match: "#db/*" -> "./src/db/*.ts"
            if (pattern.includes('*')) {
                const prefix = pattern.split('*')[0]; // "#db/"
                if (modulePath.startsWith(prefix)) {
                    const rest = modulePath.slice(prefix.length); // "connection"
                    const resolved = resolvePath(repoRoot, (target as string).replace('*', rest));
                    if (cachedExists(resolved)) {
                        return resolved;
                    }
                }
            }
        }
    } catch {
        // ignore parse errors
    }

    return null;
}

/**
 * Resolve a conditional export value to a single string path.
 * When the value is a plain string, return it directly.
 * When it's an object with condition keys, prefer: types > import > default > first value.
 */
function resolveExportValue(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        for (const key of ['types', 'import', 'default']) {
            if (typeof obj[key] === 'string') {
                return obj[key] as string;
            }
        }
        // Fallback: first value that is a string
        for (const v of Object.values(obj)) {
            if (typeof v === 'string') {
                return v;
            }
        }
    }
    return null;
}

/**
 * Resolve monorepo workspace package exports.
 * Scans workspace directories to find packages matching the import specifier.
 */
function resolveWorkspaceExport(modulePath: string, repoRoot: string): string | null {
    const rootPkgPath = join(repoRoot, 'package.json');
    if (!cachedExists(rootPkgPath)) {
        return null;
    }

    try {
        const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
        let workspaceGlobs: string[] | undefined;
        if (Array.isArray(rootPkg?.workspaces)) {
            workspaceGlobs = rootPkg.workspaces;
        } else if (rootPkg?.workspaces?.packages && Array.isArray(rootPkg.workspaces.packages)) {
            workspaceGlobs = rootPkg.workspaces.packages;
        }
        if (!workspaceGlobs) {
            return null;
        }

        // Collect all workspace package directories
        const pkgDirs: string[] = [];
        for (const ws of workspaceGlobs) {
            if (ws.endsWith('/*')) {
                // Glob pattern like "packages/*"
                const parentDir = join(repoRoot, ws.slice(0, -2));
                if (cachedExists(parentDir)) {
                    const entries = readdirSync(parentDir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            pkgDirs.push(join(parentDir, entry.name));
                        }
                    }
                }
            } else {
                pkgDirs.push(join(repoRoot, ws));
            }
        }

        // Search each workspace package for a matching name + exports/main/module
        for (const pkgDir of pkgDirs) {
            const pkgJsonPath = join(pkgDir, 'package.json');
            if (!cachedExists(pkgJsonPath)) {
                continue;
            }

            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
            const pkgName: string | undefined = pkg?.name;
            if (!pkgName) {
                continue;
            }

            const exports = pkg?.exports;

            // Check if modulePath matches this package (exact or subpath)
            if (modulePath === pkgName) {
                if (exports && typeof exports === 'object') {
                    // Root export: "." entry
                    const target = resolveExportValue(exports['.']);
                    if (target) {
                        const resolved = resolvePath(pkgDir, target);
                        if (cachedExists(resolved)) {
                            return resolved;
                        }
                    }
                } else if (!exports) {
                    // Fallback to main or module fields
                    const fallback = pkg.main ?? pkg.module;
                    if (typeof fallback === 'string') {
                        const resolved = resolvePath(pkgDir, fallback);
                        if (cachedExists(resolved)) {
                            return resolved;
                        }
                    }
                }
            } else if (modulePath.startsWith(`${pkgName}/`)) {
                const subpath = modulePath.slice(pkgName.length + 1);

                // 1. Try exports field first
                if (exports && typeof exports === 'object') {
                    const exportKey = `./${subpath}`;
                    const target = resolveExportValue(exports[exportKey]);
                    if (target) {
                        const resolved = resolvePath(pkgDir, target);
                        if (cachedExists(resolved)) {
                            return resolved;
                        }
                    }
                }

                // 2. No exports or no match? Resolve subpath directly in package directory
                const directBase = join(pkgDir, subpath);
                for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
                    if (cachedExists(directBase + ext)) {
                        return resolvePath(directBase + ext);
                    }
                }
                for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
                    const idx = join(directBase, `index${ext}`);
                    if (cachedExists(idx)) {
                        return resolvePath(idx);
                    }
                }
            }
        }
    } catch {
        // ignore parse errors
    }

    return null;
}

/**
 * Resolve an import from one file to another.
 *
 * @param fromAbsFile - Absolute path of the importing file
 * @param modulePath - The import specifier (e.g., './auth', 'express', '@/lib/db')
 * @param lang - Language key (ts, javascript, typescript, python, ruby, etc.)
 * @param repoRoot - Absolute path to the repository root
 * @param tsconfigAliases - Optional pre-loaded tsconfig aliases for TS/JS
 * @returns Absolute path to the resolved file, or null if unresolvable
 */
export function resolveImport(
    fromAbsFile: string,
    modulePath: string,
    lang: string,
    repoRoot: string,
    tsconfigAliases?: Map<string, string[]>,
): string | null {
    const resolver = RESOLVERS[lang];
    if (!resolver) {
        log.warn('No import resolver registered for language', { lang, module: modulePath, from: fromAbsFile });
        return null;
    }

    // Strip webpack/rollup loader syntax: !!loader1!loader2!actual/path
    // The actual import path is always the last segment after the final '!'
    if (modulePath.includes('!')) {
        modulePath = modulePath.split('!').pop() || modulePath;
    }

    // TS/JS-specific fallbacks: tsconfig aliases, bundler aliases, #imports, workspace exports.
    // These are Node.js/npm ecosystem features that don't apply to other languages.
    // Other languages handle their own workspace/monorepo patterns inside their resolvers
    // (Go: go.work, Rust: Cargo workspace, Java: Maven/Gradle modules).
    const isTsOrJs = lang === 'ts' || lang === 'javascript' || lang === 'typescript';

    // Handle package.json #imports (TS/JS only)
    if (isTsOrJs && modulePath.startsWith('#')) {
        const result = resolveHashImport(modulePath, repoRoot);
        if (result) {
            try {
                ensureWithinRoot(result, repoRoot);
                return result;
            } catch {
                log.warn('Import resolves outside repository root', {
                    from: fromAbsFile,
                    module: modulePath,
                    resolved: result,
                });
                return null;
            }
        }
    }

    let result = resolver(fromAbsFile, modulePath, repoRoot);

    // Fallback: tsconfig aliases for TS/JS
    if (!result && isTsOrJs && tsconfigAliases?.size) {
        result = resolveWithAliases(modulePath, tsconfigAliases, repoRoot);
    }

    // Fallback: bundler aliases (webpack/vite) for TS/JS bare specifiers
    if (!result && isTsOrJs && !modulePath.startsWith('.')) {
        const bundlerAliases = loadBundlerAliases(repoRoot);
        if (bundlerAliases.size > 0) {
            result = resolveWithAliases(modulePath, bundlerAliases, repoRoot);
        }
    }

    // Fallback: monorepo workspace exports for TS/JS bare specifiers
    if (!result && isTsOrJs && !modulePath.startsWith('.')) {
        result = resolveWorkspaceExport(modulePath, repoRoot);
    }

    // Validate resolved path is within repo root
    if (result) {
        try {
            ensureWithinRoot(result, repoRoot);
        } catch {
            log.warn('Import resolves outside repository root', {
                from: fromAbsFile,
                module: modulePath,
                resolved: result,
            });
            return null;
        }
    }

    // If still unresolved, check if it's an external package (for logging/debugging)
    if (!result) {
        const externalPkg = detectExternal(modulePath, lang, repoRoot);
        if (externalPkg) {
            // External package — expected null, don't log as warning
            return null;
        }
        // Truly unresolved local import
        log.debug('Unresolved local import', { from: fromAbsFile, module: modulePath });
    }

    return result;
}

export { loadTsconfigAliases };
