/**
 * Canonical extension -> language key map. Single source of truth shared by
 * the resolver (`languageOfFile`) and the parser (`getLanguage` / discovery /
 * batch). Kept pure so the resolver can call it without depending on the
 * parser lifecycle (which has the `registerDynamicLanguage` side-effect).
 *
 * Every language key any extractor/noise/capability/DI/receiver-types registry
 * uses must appear as a value here. The `as const` freezes the value types to
 * their exact string literals, letting us derive `LanguageKey` as the union
 * of those literals. All five `register*` entry points accept `LanguageKey`,
 * so a typo in a registration site (`'pyton'`) becomes a compile error.
 *
 * Values for the three TS/JS keys (`'TypeScript'`, `'Tsx'`, `'JavaScript'`)
 * coincide with `Lang.TypeScript`, `Lang.Tsx`, `Lang.JavaScript` (ast-grep's
 * `Lang` is a string enum), so this map doubles as the input for `parseAsync`.
 */
export const EXT_TO_LANG = {
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

function extOf(filePath: string): string | null {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) {
        return null;
    }
    return filePath.substring(dot + 1).toLowerCase();
}

export function languageOfFile(filePath: string): LanguageKey | null {
    const ext = extOf(filePath);
    if (ext === null) {
        return null;
    }
    return (EXT_TO_LANG as Record<string, LanguageKey>)[ext] ?? null;
}

/**
 * Same lookup as `languageOfFile` but accepts an extension with or without a
 * leading dot. Lets the parser side (which works in `extname()` strings like
 * `'.ts'`) share the canonical map.
 */
export function languageOfExt(ext: string): LanguageKey | null {
    const normalized = ext.startsWith('.') ? ext.substring(1) : ext;
    return (EXT_TO_LANG as Record<string, LanguageKey>)[normalized.toLowerCase()] ?? null;
}

/** Dot-prefixed extensions, for callers that surface them to the user. */
export function supportedExtensions(): string[] {
    return Object.keys(EXT_TO_LANG).map((e) => `.${e}`);
}
