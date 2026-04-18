import { registerNoise } from '../noise-registry';

/**
 * PHP stdlib + common builtin functions. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const PHP_NOISE: ReadonlySet<string> = new Set([
    // Output
    'echo',
    'print',
    'var_dump',
    'print_r',
    // Type checks
    'isset',
    'empty',
    'count',
    // Array functions
    'array_map',
    'array_filter',
    'array_reduce',
    'array_merge',
    // String utilities
    'implode',
    'explode',
]);

registerNoise('php', PHP_NOISE);
