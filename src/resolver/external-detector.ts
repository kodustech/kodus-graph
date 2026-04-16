/**
 * External-package detector dispatcher.
 *
 * Each language's detection logic lives in `src/languages/<lang>/external.ts`.
 * This file routes the `detectExternal(modulePath, lang, repoRoot)` call to
 * the right language module and re-exports the shared cache-clear helper.
 */

import { detect as detectC } from '../languages/c/external';
import { detect as detectCsharp } from '../languages/csharp/external';
import { detect as detectDart } from '../languages/dart/external';
import { detect as detectElixir } from '../languages/elixir/external';
import { clearExternalCache } from '../languages/external-shared';
import { detect as detectGo } from '../languages/go/external';
import { detect as detectJava } from '../languages/java/external';
import { detect as detectKotlin } from '../languages/kotlin/external';
import { detect as detectPhp } from '../languages/php/external';
import { detect as detectPython } from '../languages/python/external';
import { detect as detectRuby } from '../languages/ruby/external';
import { detect as detectRust } from '../languages/rust/external';
import { detect as detectScala } from '../languages/scala/external';
import { detect as detectSwift } from '../languages/swift/external';
import { detect as detectTypescript } from '../languages/typescript/external';

export { clearExternalCache };

type Detector = (modulePath: string, repoRoot: string) => string | null;

const DETECTORS: Record<string, Detector> = {
    typescript: detectTypescript,
    javascript: detectTypescript,
    ts: detectTypescript,
    python: detectPython,
    go: detectGo,
    rust: detectRust,
    java: detectJava,
    kotlin: detectKotlin,
    scala: detectScala,
    php: detectPhp,
    ruby: detectRuby,
    csharp: detectCsharp,
    dart: detectDart,
    swift: detectSwift,
    elixir: detectElixir,
    c: detectC,
    cpp: detectC,
};

/**
 * Check if an import is an external (third-party) package.
 * Returns the package name if external, null if not detected as external.
 */
export function detectExternal(modulePath: string, lang: string, repoRoot: string): string | null {
    const detector = DETECTORS[lang];
    if (!detector) {
        return null;
    }
    return detector(modulePath, repoRoot);
}
