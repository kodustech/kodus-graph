/**
 * Per-language noise registry.
 *
 * Each language module populates its entry via `registerNoise()` at import time
 * (same pattern as `registerExtractor`). The resolver looks up noise by the
 * language of the call site, not globally, so a Ruby `update()` user method
 * isn't silenced by TS-centric heuristics and vice-versa.
 */

import type { LanguageKey } from './language-of-file';
import { createLanguageRegistry } from './registry';

const REGISTRY = createLanguageRegistry<ReadonlySet<string>>();
const EMPTY: ReadonlySet<string> = new Set();

export function registerNoise(language: LanguageKey, names: ReadonlySet<string>): void {
    REGISTRY.register(language, names);
}

export function getNoiseFor(language: string): ReadonlySet<string> {
    return REGISTRY.get(language) ?? EMPTY;
}

/** Reset used by tests that seed their own entries. Not for production code. */
export function __clearNoiseRegistryForTests(): void {
    REGISTRY.__clearForTests();
}
