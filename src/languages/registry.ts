/**
 * Generic per-language registry. Backs `extractor`, `noise`, `DI`, `capabilities`,
 * and `receiver-types` — all of which share the same shape: a Map keyed by
 * `LanguageKey`, populated at module load via `register*`, and queried by the
 * resolver/analysis at runtime.
 *
 * Centralizing prevents drift across registries (e.g. one tracking insertion
 * order, another not) and gives one canonical place to add cross-cutting
 * features (telemetry, snapshots, test reset) when they're needed.
 */

import type { LanguageKey } from './language-of-file';

export interface LanguageRegistry<T> {
    register(language: LanguageKey, value: T): void;
    get(language: string): T | undefined;
    has(language: string): boolean;
    /** Insertion-order keys — relied on by parity tests that iterate languages. */
    keys(): string[];
    /** Test-only: drop all entries. Production code must not call this. */
    __clearForTests(): void;
}

export interface CreateLanguageRegistryOptions<T> {
    /**
     * Optional value transform applied at `register` time — used by the
     * capabilities registry to deep-freeze the stored object so consumers
     * can't mutate registered values.
     */
    onRegister?: (value: T) => T;
}

export function createLanguageRegistry<T>(opts: CreateLanguageRegistryOptions<T> = {}): LanguageRegistry<T> {
    const map = new Map<string, T>();
    return {
        register(language, value) {
            map.set(language, opts.onRegister ? opts.onRegister(value) : value);
        },
        get(language) {
            return map.get(language);
        },
        has(language) {
            return map.has(language);
        },
        keys() {
            return [...map.keys()];
        },
        __clearForTests() {
            map.clear();
        },
    };
}
