import c from '@ast-grep/lang-c';
import cpp from '@ast-grep/lang-cpp';
import csharp from '@ast-grep/lang-csharp';
import dart from '@ast-grep/lang-dart';
import elixir from '@ast-grep/lang-elixir';
import go from '@ast-grep/lang-go';
import java from '@ast-grep/lang-java';
import kotlin from '@ast-grep/lang-kotlin';
import php from '@ast-grep/lang-php';
import python from '@ast-grep/lang-python';
import ruby from '@ast-grep/lang-ruby';
import rust from '@ast-grep/lang-rust';
import scala from '@ast-grep/lang-scala';
import swift from '@ast-grep/lang-swift';
import { Lang, registerDynamicLanguage } from '@ast-grep/napi';
import { languageOfExt, supportedExtensions } from '../languages/language-of-file';

// Register dynamic languages at import time (side effect).
// This must happen before parseAsync can parse these languages.
registerDynamicLanguage({ python, ruby, go, java, rust, php, csharp, kotlin, swift, dart, scala, c, cpp, elixir });

// Extension -> language. Delegates to the canonical map in
// `src/languages/language-of-file.ts` so this module and the resolver agree
// on every key. Returned values are usable directly with `parseAsync`:
// `Lang.TypeScript === 'TypeScript'` (string enum), so the union of literal
// strings the canonical map produces satisfies `parseAsync(Lang | string)`.
export function getLanguage(ext: string): Lang | string | null {
    return languageOfExt(ext);
}

export function getSupportedExtensions(): string[] {
    return supportedExtensions();
}

export function isCLike(lang: Lang | string): boolean {
    return lang === 'c' || lang === 'cpp';
}

export function isTypeScriptLike(lang: Lang | string): boolean {
    return lang === Lang.TypeScript || lang === Lang.Tsx || lang === Lang.JavaScript;
}

export { Lang };
