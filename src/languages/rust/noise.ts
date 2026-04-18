import { registerNoise } from '../noise-registry';

/**
 * Rust stdlib + common macros. Calls to these are almost always
 * builtin/runtime, not user functions, and should not produce CALLS edges.
 */
export const RUST_NOISE: ReadonlySet<string> = new Set([
    // I/O macros
    'println',
    'print',
    'eprintln',
    'eprint',
    'format',
    'write',
    // Panic / assert macros
    'panic',
    'assert',
    'assert_eq',
    'assert_ne',
    // Collection macros
    'vec',
    // Option / Result + common conversions
    'unwrap',
    'expect',
    'clone',
    'to_string',
    'to_owned',
    'into',
    'from',
]);

registerNoise('rust', RUST_NOISE);
