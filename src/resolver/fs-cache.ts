/**
 * Shared filesystem cache for resolvers.
 * Caches existsSync and readdirSync results to avoid repeated disk I/O.
 * Call clearFsCache() between analysis runs.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';

const existsCache = new Map<string, boolean>();
const readdirCache = new Map<string, string[]>();
const fileContentCache = new Map<string, string>();

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

/**
 * Cached file content reader. Returns null when the file cannot be read.
 * Useful for resolvers that re-parse build configuration (pom.xml, settings.gradle)
 * across thousands of import-resolution calls.
 */
export function cachedReadFile(path: string): string | null {
    const cached = fileContentCache.get(path);
    if (cached !== undefined) {
        return cached;
    }
    try {
        const content = readFileSync(path, 'utf-8');
        fileContentCache.set(path, content);
        return content;
    } catch {
        // Sentinel: cache misses too so repeated misses don't pound the FS.
        fileContentCache.set(path, '');
        return null;
    }
}

type ClearHandler = () => void;
const clearHandlers: ClearHandler[] = [];

/**
 * Register a callback that runs whenever `clearFsCache` is called. Used by
 * resolver-level caches (e.g. Java multi-module source roots) that should be
 * invalidated alongside the underlying filesystem caches.
 */
export function registerCacheClear(handler: ClearHandler): void {
    clearHandlers.push(handler);
}

export function clearFsCache(): void {
    existsCache.clear();
    readdirCache.clear();
    fileContentCache.clear();
    for (const h of clearHandlers) {
        h();
    }
}
