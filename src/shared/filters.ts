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
