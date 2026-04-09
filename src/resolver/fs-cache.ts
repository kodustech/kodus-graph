/**
 * Shared filesystem cache for resolvers.
 * Caches existsSync and readdirSync results to avoid repeated disk I/O.
 * Call clearFsCache() between analysis runs.
 */

import { existsSync, readdirSync } from 'fs';

const existsCache = new Map<string, boolean>();
const readdirCache = new Map<string, string[]>();

export function cachedExists(path: string): boolean {
    const cached = existsCache.get(path);
    if (cached !== undefined) {
        return cached;
    }
    const result = existsSync(path);
    existsCache.set(path, result);
    return result;
}

export function cachedReaddir(path: string): string[] {
    const cached = readdirCache.get(path);
    if (cached !== undefined) {
        return cached;
    }
    try {
        const result = readdirSync(path).sort();
        readdirCache.set(path, result);
        return result;
    } catch {
        readdirCache.set(path, []);
        return [];
    }
}

export function clearFsCache(): void {
    existsCache.clear();
    readdirCache.clear();
}
