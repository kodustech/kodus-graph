/**
 * Per-language noise registry.
 *
 * Each language module populates its entry via `registerNoise()` at import time
 * (same pattern as `registerExtractor`). The resolver looks up noise by the
 * language of the call site, not globally, so a Ruby `update()` user method
 * isn't silenced by TS-centric heuristics and vice-versa.
 */

const REGISTRY = new Map<string, ReadonlySet<string>>();
const EMPTY: ReadonlySet<string> = new Set();

export function registerNoise(language: string, names: ReadonlySet<string>): void {
    REGISTRY.set(language, names);
}

export function getNoiseFor(language: string): ReadonlySet<string> {
    return REGISTRY.get(language) ?? EMPTY;
}

/** Reset used by tests that seed their own entries. Not for production code. */
export function __clearNoiseRegistryForTests(): void {
    REGISTRY.clear();
}
