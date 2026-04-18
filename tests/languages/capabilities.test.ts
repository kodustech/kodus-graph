import { describe, expect, it } from 'bun:test';
import { getCapabilitiesFor } from '../../src/languages/capabilities';
import { listRegisteredLanguages } from '../../src/languages/engine';
import '../../src/languages/typescript';
import '../../src/languages/go';
import '../../src/languages/rust';
import '../../src/languages/python';
import '../../src/languages/java';
import '../../src/languages/ruby';
import '../../src/languages/csharp';
import '../../src/languages/kotlin';
import '../../src/languages/scala';
import '../../src/languages/swift';
import '../../src/languages/dart';
import '../../src/languages/php';
import '../../src/languages/c';
import '../../src/languages/elixir';

describe('LanguageCapabilities registry', () => {
    it('TypeScript: async + decorators + exceptions + structural', () => {
        const c = getCapabilitiesFor('TypeScript')!;
        expect(c.hasAsync).toBe(true);
        expect(c.hasDecorators).toBe(true);
        expect(c.hasExceptions).toBe(true);
        expect(c.hasStaticTypes).toBe(true);
        expect(c.interfaceKind).toBe('structural');
    });

    it('JavaScript inherits TS async/decorators/exceptions but is dynamic', () => {
        const c = getCapabilitiesFor('JavaScript')!;
        expect(c.hasAsync).toBe(true);
        expect(c.hasStaticTypes).toBe(false);
    });

    it('Go: no async, no decorators, structural, static', () => {
        const c = getCapabilitiesFor('go')!;
        expect(c.hasAsync).toBe(false);
        expect(c.hasDecorators).toBe(false);
        expect(c.hasExceptions).toBe(false);
        expect(c.hasStaticTypes).toBe(true);
        expect(c.interfaceKind).toBe('structural');
    });

    it('Rust: async + attributes, Result-based (no exceptions), nominal traits', () => {
        const c = getCapabilitiesFor('rust')!;
        expect(c.hasAsync).toBe(true);
        expect(c.hasDecorators).toBe(true);
        expect(c.hasExceptions).toBe(false);
        expect(c.hasStaticTypes).toBe(true);
        expect(c.interfaceKind).toBe('nominal');
    });

    it('Python: async + decorators + exceptions + duck typing, no static', () => {
        const c = getCapabilitiesFor('python')!;
        expect(c.hasAsync).toBe(true);
        expect(c.hasDecorators).toBe(true);
        expect(c.hasExceptions).toBe(true);
        expect(c.hasStaticTypes).toBe(false);
        expect(c.interfaceKind).toBe('duck');
    });

    it('Ruby: no async, exceptions, duck typing', () => {
        const c = getCapabilitiesFor('ruby')!;
        expect(c.hasAsync).toBe(false);
        expect(c.hasExceptions).toBe(true);
        expect(c.interfaceKind).toBe('duck');
    });

    it('Java: nominal interfaces, static types, async + exceptions', () => {
        const c = getCapabilitiesFor('java')!;
        expect(c.interfaceKind).toBe('nominal');
        expect(c.hasStaticTypes).toBe(true);
    });

    it('C: no async, no exceptions, no decorators', () => {
        const c = getCapabilitiesFor('c')!;
        expect(c.hasAsync).toBe(false);
        expect(c.hasExceptions).toBe(false);
        expect(c.hasDecorators).toBe(false);
    });

    it('C++ differs from C by having exceptions', () => {
        const c = getCapabilitiesFor('cpp')!;
        expect(c.hasExceptions).toBe(true);
        expect(c.hasAsync).toBe(false);
    });

    it('Elixir: no async (it is BEAM-concurrent, not async/await)', () => {
        const c = getCapabilitiesFor('elixir')!;
        expect(c.hasAsync).toBe(false);
    });

    it('unknown language returns null', () => {
        expect(getCapabilitiesFor('Klingon')).toBeNull();
    });

    // Parity: the extractor registry is the canonical source of "which languages
    // exist". If a future dev adds `registerExtractor('foo', ...)` but forgets
    // `registerCapabilities('foo', ...)`, this test catches it — no new language
    // can slip in without a capabilities entry.
    //
    // Note: `extractor-engine.test.ts` registers stub extractors under `__test_*__`
    // sentinel keys (shared global registry; test isolation limit). Those are
    // not real languages and are filtered out here.
    it('every language with a registered extractor has capabilities', () => {
        const langs = listRegisteredLanguages().filter((l) => !l.startsWith('__'));
        expect(langs.length).toBeGreaterThan(0);
        for (const lang of langs) {
            expect(getCapabilitiesFor(lang)).not.toBeNull();
        }
    });
});
