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

// Register dynamic languages at import time (side effect).
// This must happen before parseAsync can parse these languages.
registerDynamicLanguage({ python, ruby, go, java, rust, php, csharp, kotlin, swift, dart, scala, c, cpp, elixir });

// ---------------------------------------------------------------------------
// Extension -> language identifier
// Built-in langs use Lang enum, dynamic langs use lowercase string
// ---------------------------------------------------------------------------

const EXT_TO_LANG: Record<string, Lang | string> = {
    '.ts': Lang.TypeScript,
    '.tsx': Lang.Tsx,
    '.js': Lang.JavaScript,
    '.jsx': Lang.JavaScript,
    '.mjs': Lang.JavaScript,
    '.cjs': Lang.JavaScript,
    '.es6': Lang.JavaScript,
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.java': 'java',
    '.rs': 'rust',
    '.cs': 'csharp',
    '.php': 'php',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.swift': 'swift',
    '.dart': 'dart',
    '.scala': 'scala',
    '.sc': 'scala',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cc': 'cpp',
    '.hh': 'cpp',
    '.cxx': 'cpp',
    '.ex': 'elixir',
    '.exs': 'elixir',
};

export function getLanguage(ext: string): Lang | string | null {
    return EXT_TO_LANG[ext] ?? null;
}

export function getSupportedExtensions(): string[] {
    return Object.keys(EXT_TO_LANG);
}

export function getLanguageName(lang: Lang | string): string {
    if (typeof lang === 'string') {
        return lang;
    }
    if (lang === Lang.TypeScript || lang === Lang.Tsx) {
        return 'typescript';
    }
    if (lang === Lang.JavaScript) {
        return 'javascript';
    }
    return 'unknown';
}

export function isCLike(lang: Lang | string): boolean {
    return lang === 'c' || lang === 'cpp';
}

export function isTypeScriptLike(lang: Lang | string): boolean {
    return lang === Lang.TypeScript || lang === Lang.Tsx || lang === Lang.JavaScript;
}

// ---------------------------------------------------------------------------
// LANG_KINDS — AST node kind strings used by per-language extractors.
// Only typescript, python, and ruby extractors still reference this;
// all other languages use hardcoded kind strings in their dedicated extractors.
// ---------------------------------------------------------------------------

export const LANG_KINDS: Record<string, Record<string, string>> = {
    typescript: {
        class: 'class_declaration',
        function: 'function_declaration',
        method: 'method_definition',
        interface: 'interface_declaration',
        enum: 'enum_declaration',
        import: 'import_statement',
        abstractClass: 'abstract_class_declaration',
        arrowContainer: 'variable_declarator',
        arrowFunction: 'arrow_function',
        export: 'export_statement',
        methodSignature: 'method_signature',
    },
    python: {
        class: 'class_definition',
        function: 'function_definition',
        method: 'function_definition',
        import: 'import_from_statement',
        importRegular: 'import_statement',
        decorator: 'decorator',
    },
    ruby: {
        class: 'class',
        method: 'method',
        module: 'module',
        singletonMethod: 'singleton_method',
        call: 'call',
    },
};

export { Lang };
