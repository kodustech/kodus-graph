/**
 * Pure lookup: file path -> language key used by extractors and the noise
 * registry. Mirrors the extension-to-language mapping in
 * `src/parser/languages.ts`. Kept pure so the resolver can call it without
 * depending on the parser lifecycle.
 */
const EXT_TO_LANG: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'Tsx',
    js: 'JavaScript',
    jsx: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    es6: 'JavaScript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    rs: 'rust',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    dart: 'dart',
    scala: 'scala',
    sc: 'scala',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    ex: 'elixir',
    exs: 'elixir',
};

export function languageOfFile(filePath: string): string | null {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) {
        return null;
    }
    const ext = filePath.substring(dot + 1).toLowerCase();
    return EXT_TO_LANG[ext] ?? null;
}
