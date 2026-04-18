export const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    'vendor',
    '__pycache__',
    '.venv',
    'venv',
    'target',
    '.turbo',
    '.cache',
    '.output',
    'out',
    '.nuxt',
    '.svelte-kit',
    '.idea',
    '.mypy_cache',
    '.tox',
    '.pytest_cache',
    '.eggs',
    'bower_components',
]);

/** File name patterns to skip during discovery (minified, bundled, vendored) */
const SKIP_FILE_PATTERNS: RegExp[] = [
    /\.min\.\w+$/, // *.min.js, *.min.css
    /[.-]bundle\.\w+$/, // *.bundle.js, *-bundle.js
    /\.chunk\.\w+$/, // *.chunk.js (webpack)
    /\.packed\.\w+$/, // *.packed.js
];

export function isSkippableFile(fileName: string): boolean {
    return SKIP_FILE_PATTERNS.some((p) => p.test(fileName));
}

/**
 * Generic call names that are commonly overloaded across unrelated files.
 *
 * Unlike NOISE, these names can still resolve at higher-confidence tiers
 * (same file, import-resolved, DI). But at the ambiguous tier they generate
 * low-signal 0.30 edges across unrelated modules, so we drop them.
 *
 * Examples: calling `validate()` where 50 unrelated classes define `validate` —
 * picking the "closest by directory proximity" is usually wrong.
 */
export const AMBIGUOUS_NOISE = new Set([
    'validate',
    'create',
    'process',
    'handle',
    'run',
    'execute',
    'init',
    'initialize',
    'build',
    'save',
    'load',
    'update',
    'fetch',
    'send',
    'receive',
    'connect',
    'disconnect',
    'open',
    'close',
    'start',
    'stop',
    'reset',
    'refresh',
    'reload',
    'cancel',
    'destroy',
    'dispose',
    'check',
    'verify',
    'parse',
    'serialize',
    'deserialize',
    'format',
    'normalize',
    'sanitize',
    'transform',
    'convert',
    'encode',
    'decode',
    'emit',
    'dispatch',
    'listen',
    'subscribe',
    'unsubscribe',
    'notify',
    'register',
    'unregister',
    'getInstance',
    'setup',
    'teardown',
    'config',
    'configure',
    'getValue',
    'setValue',
    'getName',
    'setName',
    'getId',
    'setId',
]);
