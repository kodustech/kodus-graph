import { registerNoise } from '../noise-registry';

/**
 * Bash builtins, keywords-as-commands, and ubiquitous coreutils. Invocations of
 * these are shell/runtime, not user-defined functions, so they must not produce
 * CALLS edges. `source` and `.` are here too: the extractor turns them into
 * IMPORTS, and the bare command should not also resolve as a call.
 *
 * Noise is filtered by the resolver AFTER the receiver tier, so a user function
 * that happens to shadow one of these names still resolves when it exists in the
 * codebase — the set only suppresses calls with no in-repo definition.
 */
export const BASH_NOISE: ReadonlySet<string> = new Set([
    // Sourcing (emitted as IMPORTS instead)
    'source',
    '.',
    // Builtins / keywords
    'echo',
    'printf',
    'read',
    'cd',
    'pwd',
    'export',
    'local',
    'declare',
    'readonly',
    'unset',
    'set',
    'shift',
    'return',
    'exit',
    'eval',
    'exec',
    'trap',
    'wait',
    'kill',
    'true',
    'false',
    'test',
    'type',
    'command',
    'getopts',
    'shopt',
    'break',
    'continue',
    'sleep',
    // Common coreutils
    'ls',
    'cat',
    'cp',
    'mv',
    'rm',
    'mkdir',
    'rmdir',
    'touch',
    'ln',
    'chmod',
    'chown',
    'grep',
    'sed',
    'awk',
    'cut',
    'tr',
    'sort',
    'uniq',
    'head',
    'tail',
    'wc',
    'find',
    'xargs',
    'tee',
    'basename',
    'dirname',
    'realpath',
    'env',
    'date',
    'curl',
    'wget',
    'tar',
    'git',
    'make',
    'sudo',
]);

registerNoise('bash', BASH_NOISE);
