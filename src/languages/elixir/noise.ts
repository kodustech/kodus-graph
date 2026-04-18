import { registerNoise } from '../noise-registry';

/**
 * Elixir stdlib + common module names. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const ELIXIR_NOISE: ReadonlySet<string> = new Set([
    // IO
    'IO',
    'puts',
    'inspect',
    // Enum
    'Enum',
    'map',
    'filter',
    'reduce',
    'each',
    // Conversion + data modules
    'to_string',
    'String',
    'Map',
    'List',
]);

registerNoise('elixir', ELIXIR_NOISE);
