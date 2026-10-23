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
    // ── Generated code — well-known codegen conventions, not hand-written.
    // Skipping them keeps the blast radius and review focused on real code
    // (a 5k-line protobuf stub isn't a review target and only adds noise).
    // Conservative on purpose: only patterns that are unambiguously generated.
    /\.pb\.\w+$/, // protobuf: *.pb.go, *.pb.ts
    /_pb2\.pyi?$/, // python protobuf: *_pb2.py, *_pb2.pyi
    /\.generated\.\w+$/, // *.generated.ts / .cs / …
    /\.gen\.\w+$/, // *.gen.go / .ts (codegen convention)
    /\.g\.dart$/, // dart codegen (json_serializable, etc.)
    /\.freezed\.dart$/, // dart freezed
    /\.designer\.cs$/, // C# designer-generated
];

export function isSkippableFile(fileName: string): boolean {
    return SKIP_FILE_PATTERNS.some((p) => p.test(fileName));
}
