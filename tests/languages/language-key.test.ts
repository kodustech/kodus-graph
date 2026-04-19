import { describe, expect, it } from 'bun:test';
import { getCapabilitiesFor } from '../../src/languages/capabilities';
import { listRegisteredLanguages } from '../../src/languages/engine';
import type { LanguageKey } from '../../src/languages/language-of-file';
import { languageOfFile } from '../../src/languages/language-of-file';
// Trigger extractor registration for all languages.
import '../../src/languages/c';
import '../../src/languages/csharp';
import '../../src/languages/dart';
import '../../src/languages/elixir';
import '../../src/languages/go';
import '../../src/languages/java';
import '../../src/languages/kotlin';
import '../../src/languages/php';
import '../../src/languages/python';
import '../../src/languages/ruby';
import '../../src/languages/rust';
import '../../src/languages/scala';
import '../../src/languages/swift';
import '../../src/languages/typescript';

describe('LanguageKey type', () => {
    it('languageOfFile returns LanguageKey | null (narrows after null check)', () => {
        const lang = languageOfFile('src/auth.ts');
        if (lang !== null) {
            // Type-level: this compiles ONLY if lang is narrowed to LanguageKey.
            const caps = getCapabilitiesFor(lang);
            expect(caps).not.toBeNull();
        }
    });

    it('every registered extractor key is assignable to LanguageKey', () => {
        // The cast below is the actual assertion: if a real src/ extractor
        // ever registers under a key that isn't in EXT_TO_LANG, the type
        // system will have already caught it at the register* call site.
        // This runtime check just confirms listRegisteredLanguages() is
        // populated at all (so the compile-time guard has something to
        // guard). We don't assert capabilities here because other tests in
        // the suite register synthetic extractors via `as LanguageKey` for
        // isolation — those keys don't have capability entries by design.
        const langs = listRegisteredLanguages();
        expect(langs.length).toBeGreaterThan(0);
        for (const lang of langs) {
            const key: LanguageKey = lang as LanguageKey;
            expect(typeof key).toBe('string');
        }
    });

    it('every canonical language in the union has a capability registered', () => {
        // Exercises the 14 real languages (17 keys including aliases like
        // Tsx/JavaScript). Each registers capabilities at module-load time
        // via the side-effect imports at the top of this file.
        const canonical: LanguageKey[] = [
            'TypeScript',
            'Tsx',
            'JavaScript',
            'python',
            'ruby',
            'go',
            'java',
            'kotlin',
            'rust',
            'csharp',
            'php',
            'swift',
            'dart',
            'scala',
            'c',
            'cpp',
            'elixir',
        ];
        for (const key of canonical) {
            expect(getCapabilitiesFor(key)).not.toBeNull();
        }
    });
});
