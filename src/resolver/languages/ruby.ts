/**
 * Ruby import resolver.
 *
 * Handles require_relative paths and Gemfile path: gems.
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

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
