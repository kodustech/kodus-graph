import { registerNoise } from '../noise-registry';

/**
 * Dart stdlib + Object methods. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const DART_NOISE: ReadonlySet<string> = new Set([
    // I/O
    'print',
    // Object methods
    'toString',
    'hashCode',
    'runtimeType',
    'noSuchMethod',
]);

registerNoise('dart', DART_NOISE);
