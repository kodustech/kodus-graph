/**
 * Ruby import resolver.
 *
 * Handles require_relative paths, Gemfile path: gems, and Zeitwerk autoload.
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../../resolver/fs-cache';

/** Cache parsed Gemfile path gems per repo root. */
const gemfileCache = new Map<string, string[]>();

/**
 * Parse Gemfile for path: gems and return their lib directories (absolute).
 */
function getGemPathLibDirs(repoRoot: string): string[] {
    if (gemfileCache.has(repoRoot)) {
        return gemfileCache.get(repoRoot)!;
    }

    const gemfilePath = join(repoRoot, 'Gemfile');
    const libDirs: string[] = [];

    if (cachedExists(gemfilePath)) {
        const content = readFileSync(gemfilePath, 'utf-8');
        // Match lines like: gem 'mylib', path: './libs/mylib'
        const regex = /^\s*gem\s+['"][^'"]+['"]\s*,\s*path:\s*['"]([^'"]+)['"]/gm;
        let match: RegExpExecArray | null = regex.exec(content);
        while (match !== null) {
            const gemPath = match[1];
            libDirs.push(resolvePath(join(repoRoot, gemPath, 'lib')));
            match = regex.exec(content);
        }
    }

    gemfileCache.set(repoRoot, libDirs);
    return libDirs;
}

/**
 * Resolve a Ruby require/require_relative to a file path.
 */
export function resolve(fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (!modulePath) {
        return null;
    }

    // 1. Try relative resolution (require_relative style)
    const base = join(dirname(fromAbsFile), modulePath);
    if (cachedExists(`${base}.rb`)) {
        return resolvePath(`${base}.rb`);
    }
    if (cachedExists(base)) {
        return resolvePath(base);
    }

    // 2. Try Gemfile path: gems
    for (const libDir of getGemPathLibDirs(repoRoot)) {
        const candidate = join(libDir, modulePath);
        if (cachedExists(`${candidate}.rb`)) {
            return resolvePath(`${candidate}.rb`);
        }
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }

    return null;
}

/** Common Rails autoload paths that Zeitwerk watches. */
const ZEITWERK_AUTOLOAD_PATHS = [
    'app/models',
    'app/controllers',
    'app/services',
    'app/jobs',
    'app/mailers',
    'app/helpers',
    'lib',
];

/**
 * Convert a CamelCase segment to snake_case.
 * E.g., "AuthService" → "auth_service", "UsersController" → "users_controller"
 */
function camelToSnake(name: string): string {
    return name
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

/**
 * Resolve a Ruby class/module constant name to a file path using Zeitwerk conventions.
 *
 * Zeitwerk maps constant names to file paths:
 *   - `User` → `user.rb`
 *   - `AuthService` → `auth_service.rb`
 *   - `Admin::UsersController` → `admin/users_controller.rb`
 *
 * This searches common Rails autoload paths for a matching file.
 *
 * @param className - The fully-qualified constant name (e.g., "Admin::UsersController")
 * @param repoRoot  - The root of the repository / Rails project
 * @returns Absolute path to the resolved file, or null if not found
 */
export function resolveZeitwerk(className: string, repoRoot: string): string | null {
    if (!className) {
        return null;
    }

    // Split on :: and convert each segment from CamelCase to snake_case
    const segments = className.split('::');
    const relativePath = segments.map(camelToSnake).join('/');

    // Search each autoload path
    for (const autoloadPath of ZEITWERK_AUTOLOAD_PATHS) {
        const candidate = join(repoRoot, autoloadPath, `${relativePath}.rb`);
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }

    return null;
}
