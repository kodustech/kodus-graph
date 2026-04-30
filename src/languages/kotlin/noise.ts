import { registerNoise } from '../noise-registry';

/**
 * Kotlin stdlib top-level functions. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 *
 * Expanded 2026-04-30 to address the kotlinx.coroutines ambig pollution:
 * names like `check`, `requireNotNull`, `lazy`, `repeat`, `arrayOf`, etc.
 * are pervasive in coroutines code, were resolving to user-domain candidates
 * by proximity, and inflating `ambiguous` counts.
 */
export const KOTLIN_NOISE: ReadonlySet<string> = new Set([
    // I/O
    'println',
    'print',
    // Collection / array builders
    'listOf',
    'mapOf',
    'setOf',
    'listOfNotNull',
    'setOfNotNull',
    'arrayOf',
    'arrayListOf',
    'mutableListOf',
    'mutableMapOf',
    'mutableSetOf',
    'hashMapOf',
    'hashSetOf',
    'linkedMapOf',
    'linkedSetOf',
    'sortedMapOf',
    'sortedSetOf',
    'emptyList',
    'emptyMap',
    'emptySet',
    // Scope functions
    'let',
    'apply',
    'run',
    'also',
    'with',
    // Preconditions
    'require',
    'requireNotNull',
    'check',
    'checkNotNull',
    'error',
    'assert',
    // Stdlib helpers
    'lazy',
    'lazyOf',
    'repeat',
    'synchronized',
    'TODO',
    'runCatching',
]);

registerNoise('kotlin', KOTLIN_NOISE);
