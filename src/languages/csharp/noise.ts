import { registerNoise } from '../noise-registry';

/**
 * C# stdlib + Object methods. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const CSHARP_NOISE: ReadonlySet<string> = new Set([
    // Console
    'Console',
    'WriteLine',
    'Write',
    // Object methods
    'ToString',
    'Equals',
    'GetHashCode',
    'GetType',
]);

registerNoise('csharp', CSHARP_NOISE);
