import { registerNoise } from '../noise-registry';

/**
 * Kotlin stdlib + scope functions. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const KOTLIN_NOISE: ReadonlySet<string> = new Set([
    // I/O
    'println',
    'print',
    // Collection builders
    'listOf',
    'mapOf',
    'setOf',
    // Scope functions
    'let',
    'apply',
    'run',
    'also',
    'with',
    // Preconditions
    'require',
]);

registerNoise('kotlin', KOTLIN_NOISE);
