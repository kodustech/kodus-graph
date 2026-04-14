/**
 * Elixir import resolver.
 *
 * Resolves Elixir module names to file paths using Elixir/Mix conventions:
 *  - MyApp.UserService → lib/my_app/user_service.ex
 *  - CamelCase segments are converted to snake_case
 *  - The project name (first segment) maps to the lib/ directory
 *
 * Also handles:
 *  - mix.exs deps (external detection)
 *  - Umbrella apps (apps/app_name/lib/...)
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

/** Cache parsed mix.exs deps per repo root. */
const mixDepsCache = new Map<string, Set<string>>();

/**
 * Convert a CamelCase module segment to snake_case.
 * E.g., "UserService" → "user_service", "HTTPClient" → "http_client"
 */
function camelToSnake(name: string): string {
    return name
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

/**
 * Convert an Elixir module name to a relative file path.
 * MyApp.UserService → my_app/user_service
 * MyApp.Repo → my_app/repo
 */
function moduleToRelativePath(moduleName: string): string {
    const segments = moduleName.split('.');
    return segments.map(camelToSnake).join('/');
}

/**
 * Resolve an Elixir module name to a file path.
 *
 * Elixir conventions:
 *  1. Module names map to files in lib/ directory
 *  2. MyApp.UserService → lib/my_app/user_service.ex
 *  3. For umbrella apps: apps/<app_name>/lib/...
 *
 * @param fromAbsFile - Absolute path of the importing file
 * @param moduleName  - The module name (e.g., "MyApp.Repo", "Ecto.Query")
 * @param repoRoot    - Absolute path to the repository root
 * @returns Absolute path to the resolved file, or null if not found
 */
export function resolve(fromAbsFile: string, moduleName: string, repoRoot: string): string | null {
    if (!moduleName) {
        return null;
    }

    const relativePath = moduleToRelativePath(moduleName);

    // 1. Try lib/ directory (standard Mix project)
    for (const ext of ['.ex', '.exs']) {
        const candidate = join(repoRoot, 'lib', `${relativePath}${ext}`);
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }

    // 2. Try umbrella apps: apps/<app_name>/lib/...
    //    For MyApp.Repo → apps/my_app/lib/my_app/repo.ex
    const segments = moduleName.split('.');
    if (segments.length >= 2) {
        const appName = camelToSnake(segments[0]);
        const restPath = segments.slice(1).map(camelToSnake).join('/');
        for (const ext of ['.ex', '.exs']) {
            // Full path under the app's lib
            const candidate = join(repoRoot, 'apps', appName, 'lib', appName, `${restPath}${ext}`);
            if (cachedExists(candidate)) {
                return resolvePath(candidate);
            }
            // Also try without the app prefix in the lib directory
            const candidate2 = join(repoRoot, 'apps', appName, 'lib', `${relativePath}${ext}`);
            if (cachedExists(candidate2)) {
                return resolvePath(candidate2);
            }
        }
    }

    // 3. Try relative to the importing file's directory
    const dir = dirname(fromAbsFile);
    for (const ext of ['.ex', '.exs']) {
        const candidate = join(dir, `${relativePath}${ext}`);
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }

    return null;
}

/**
 * Parse mix.exs for dependency names.
 * Returns the set of dep atom names.
 */
export function loadMixDeps(repoRoot: string): Set<string> {
    if (mixDepsCache.has(repoRoot)) {
        return mixDepsCache.get(repoRoot)!;
    }

    const deps = new Set<string>();
    const mixPath = join(repoRoot, 'mix.exs');

    if (cachedExists(mixPath)) {
        try {
            const content = readFileSync(mixPath, 'utf-8');
            // Match {:dep_name, "~> version"} or {:dep_name, ">= version"}
            // or {:dep_name, git: "..."} etc.
            const regex = /\{:([a-z_][a-z0-9_]*)\s*,/g;
            let match: RegExpExecArray | null = regex.exec(content);
            while (match !== null) {
                deps.add(match[1]);
                match = regex.exec(content);
            }
        } catch {
            // ignore read errors
        }
    }

    mixDepsCache.set(repoRoot, deps);
    return deps;
}
