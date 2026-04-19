/**
 * Per-language capability declarations. Each language registers what it
 * supports at module load. Analysis code consults the registry instead of
 * assuming TS/Java semantics everywhere.
 */

import type { LanguageKey } from './language-of-file';

export interface LanguageCapabilities {
    /** Language has explicit async/await keyword semantics. */
    hasAsync: boolean;
    /** Decorators / annotations / attributes that attach metadata to declarations. */
    hasDecorators: boolean;
    /** try/catch-style exception handling (distinct from Result/Option or error returns). */
    hasExceptions: boolean;
    /** Types checked statically at compile-time. False = dynamic / duck-typed / gradual. */
    hasStaticTypes: boolean;
    /** How interfaces (or equivalents) match against implementations. */
    interfaceKind: 'nominal' | 'structural' | 'duck';
}

const REGISTRY = new Map<string, Readonly<LanguageCapabilities>>();

export function registerCapabilities(language: LanguageKey, caps: LanguageCapabilities): void {
    REGISTRY.set(language, Object.freeze({ ...caps }));
}

export function getCapabilitiesFor(language: string): Readonly<LanguageCapabilities> | null {
    return REGISTRY.get(language) ?? null;
}
