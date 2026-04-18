import { registerNoise } from '../noise-registry';

/**
 * C / C++ stdlib functions. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const C_NOISE: ReadonlySet<string> = new Set([
    // Formatted I/O
    'printf',
    'fprintf',
    'sprintf',
    'scanf',
    // Memory
    'malloc',
    'free',
    'memcpy',
    'memset',
    // String
    'strlen',
    'strcpy',
    'strcmp',
    // Operator-ish
    'sizeof',
]);

registerNoise('c', C_NOISE);
registerNoise('cpp', C_NOISE);
