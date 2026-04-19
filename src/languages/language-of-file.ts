/**
 * Pure lookup: file path -> language key used by extractors and the noise
 * registry. Mirrors the extension-to-language mapping in
 * `src/parser/languages.ts`. Kept pure so the resolver can call it without
 * depending on the parser lifecycle.
 *
 * `EXT_TO_LANG` is the canonical source of truth: every language key any
 * extractor/noise/capability/DI/receiver-types registry uses must appear as
 * a value here. The `as const` freezes the object's value types to their
 * exact string literals, letting us derive `LanguageKey` as the union of
 * those literals. All five `register*` entry points accept `LanguageKey`,
 * so a typo in a registration site (`'pyton'`) becomes a compile error.
 */
const EXT_TO_LANG = {
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
} as const;

export type LanguageKey = (typeof EXT_TO_LANG)[keyof typeof EXT_TO_LANG];

export function languageOfFile(filePath: string): LanguageKey | null {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) {
        return null;
    }
    const ext = filePath.substring(dot + 1).toLowerCase();
    return (EXT_TO_LANG as Record<string, LanguageKey>)[ext] ?? null;
}
