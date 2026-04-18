import { registerNoise } from '../noise-registry';

/**
 * Java stdlib + Object methods. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const JAVA_NOISE: ReadonlySet<string> = new Set([
    // System + I/O
    'System',
    'println',
    // Object methods
    'equals',
    'hashCode',
    'getClass',
    'toString',
]);

registerNoise('java', JAVA_NOISE);
