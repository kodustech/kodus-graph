/**
 * Shared primitives used by per-language external-package detectors.
 *
 * Provides:
 * - LangDeps type (packages + language-specific metadata)
 * - Dependency cache (per repoRoot → per language)
 * - Safe file/JSON readers
 * - getOrLoadDeps(lang, repoRoot, loader) helper
 * - clearExternalCache() to reset between runs
 */

import { readFileSync } from 'fs';
import { cachedExists } from '../resolver/fs-cache';

export interface LangDeps {
    packages: Set<string>;
    /** Extra metadata per language (e.g. Go module path, Dart package name). */
    meta?: Record<string, string>;
}

/** Cached per-language deps keyed by repoRoot. */
const depsCache = new Map<string, Map<string, LangDeps>>();

export function clearExternalCache(): void {
    depsCache.clear();
}

/** Read a file if present, swallowing errors. */
export function safeRead(filePath: string): string | null {
    if (!cachedExists(filePath)) {
        return null;
    }
    try {
        return readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/** Read + JSON-parse a file, returning null on any failure. */
export function safeParseJson(filePath: string): Record<string, unknown> | null {
    const text = safeRead(filePath);
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Fetch the cached LangDeps for (lang, repoRoot), invoking `loader` on miss.
 * Loader is only called when no entry exists for that language in the cache.
 */
export function getOrLoadDeps(lang: string, repoRoot: string, loader: () => LangDeps): LangDeps {
    let byLang = depsCache.get(repoRoot);
    if (!byLang) {
        byLang = new Map<string, LangDeps>();
        depsCache.set(repoRoot, byLang);
    }
    const cached = byLang.get(lang);
    if (cached) {
        return cached;
    }
    const result = loader();
    byLang.set(lang, result);
    return result;
}

/**
 * Write a shared LangDeps entry for multiple language keys (e.g. Java deps
 * are reused by Kotlin and Scala).
 */
export function setSharedDeps(repoRoot: string, langs: string[], deps: LangDeps): void {
    let byLang = depsCache.get(repoRoot);
    if (!byLang) {
        byLang = new Map<string, LangDeps>();
        depsCache.set(repoRoot, byLang);
    }
    for (const lang of langs) {
        byLang.set(lang, deps);
    }
}
