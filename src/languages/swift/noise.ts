import { registerNoise } from '../noise-registry';

/**
 * Swift stdlib + common built-in types. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const SWIFT_NOISE: ReadonlySet<string> = new Set([
    // I/O
    'print',
    'debugPrint',
    'dump',
    // Built-in types
    'String',
    'Int',
    'Double',
    'Array',
    'Dictionary',
    'Optional',
]);

registerNoise('swift', SWIFT_NOISE);
