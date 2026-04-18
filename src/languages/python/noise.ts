import { registerNoise } from '../noise-registry';

/**
 * Python stdlib + common builtin names. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const PYTHON_NOISE: ReadonlySet<string> = new Set([
    // Builtins
    'print',
    'len',
    'range',
    'enumerate',
    'zip',
    'isinstance',
    'type',
    'super',
    'self',
    'cls',
    'None',
    'True',
    'False',
    // List/dict methods
    'append',
    'extend',
    'insert',
    'remove',
    'update',
    'items',
    // String methods
    'format',
    'strip',
    'upper',
    'lower',
]);

registerNoise('python', PYTHON_NOISE);
