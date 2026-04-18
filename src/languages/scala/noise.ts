import { registerNoise } from '../noise-registry';

/**
 * Scala stdlib + common collection types. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const SCALA_NOISE: ReadonlySet<string> = new Set([
    // I/O
    'println',
    'print',
    // Option / collection types
    'Some',
    'None',
    'Option',
    'Seq',
    'List',
    'Map',
    'Set',
    // Object methods
    'toString',
]);

registerNoise('scala', SCALA_NOISE);
