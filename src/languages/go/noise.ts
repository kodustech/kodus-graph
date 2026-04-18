import { registerNoise } from '../noise-registry';

/**
 * Go stdlib + common package names. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const GO_NOISE: ReadonlySet<string> = new Set([
    // fmt package
    'fmt',
    'Println',
    'Printf',
    'Sprintf',
    'Errorf',
    // Builtins
    'make',
    'panic',
    'recover',
    'defer',
    'len',
    'cap',
    'append',
    'copy',
    'new',
    'close',
    'delete',
]);

registerNoise('go', GO_NOISE);
