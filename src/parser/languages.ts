import csharp from '@ast-grep/lang-csharp';
import go from '@ast-grep/lang-go';
import java from '@ast-grep/lang-java';
import php from '@ast-grep/lang-php';
import python from '@ast-grep/lang-python';
import ruby from '@ast-grep/lang-ruby';
import rust from '@ast-grep/lang-rust';
import { Lang, registerDynamicLanguage } from '@ast-grep/napi';

// Register dynamic languages at import time (side effect).
// This must happen before parseAsync can parse these languages.
registerDynamicLanguage({ python, ruby, go, java, rust, php, csharp });

// Extension -> language identifier
// Built-in langs use Lang enum, dynamic langs use lowercase string
const EXT_TO_LANG: Record<string, Lang | string> = {
  '.ts': Lang.TypeScript,
  '.tsx': Lang.Tsx,
  '.js': Lang.JavaScript,
  '.jsx': Lang.JavaScript,
  '.mjs': Lang.JavaScript,
  '.cjs': Lang.JavaScript,
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.java': 'java',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.php': 'php',
};

export function getLanguage(ext: string): Lang | string | null {
  return EXT_TO_LANG[ext] ?? null;
}

export function getSupportedExtensions(): string[] {
  return Object.keys(EXT_TO_LANG);
}

export function getLanguageName(lang: Lang | string): string {
  if (typeof lang === 'string') return lang;
  if (lang === Lang.TypeScript || lang === Lang.Tsx) return 'typescript';
  if (lang === Lang.JavaScript) return 'javascript';
  return 'unknown';
}

export function isTypeScriptLike(lang: Lang | string): boolean {
  return lang === Lang.TypeScript || lang === Lang.Tsx || lang === Lang.JavaScript;
}

// AST node kinds per language for structural extraction
export const LANG_KINDS: Record<string, Record<string, string>> = {
  typescript: {
    class: 'class_declaration',
    abstractClass: 'abstract_class_declaration',
    method: 'method_definition',
    function: 'function_declaration',
    arrowContainer: 'variable_declarator',
    arrowFunction: 'arrow_function',
    interface: 'interface_declaration',
    enum: 'enum_declaration',
    import: 'import_statement',
    export: 'export_statement',
    methodSignature: 'method_signature',
  },
  python: {
    class: 'class_definition',
    method: 'function_definition',
    function: 'function_definition',
    import: 'import_from_statement',
    importRegular: 'import_statement',
    decorator: 'decorator',
  },
  ruby: {
    class: 'class',
    method: 'method',
    singletonMethod: 'singleton_method',
    module: 'module',
    call: 'call',
  },
  go: {
    function: 'function_declaration',
    method: 'method_declaration',
    struct: 'type_declaration',
    interface: 'type_declaration',
    import: 'import_declaration',
  },
  java: {
    class: 'class_declaration',
    interface: 'interface_declaration',
    method: 'method_declaration',
    constructor: 'constructor_declaration',
    import: 'import_declaration',
    enum: 'enum_declaration',
  },
  rust: {
    function: 'function_item',
    struct: 'struct_item',
    impl: 'impl_item',
    trait: 'trait_item',
    enum: 'enum_item',
    use: 'use_declaration',
  },
  csharp: {
    class: 'class_declaration',
    interface: 'interface_declaration',
    method: 'method_declaration',
    constructor: 'constructor_declaration',
    using: 'using_directive',
    enum: 'enum_declaration',
    namespace: 'namespace_declaration',
  },
  php: {
    class: 'class_declaration',
    method: 'method_declaration',
    function: 'function_definition',
    namespace: 'namespace_definition',
    use: 'namespace_use_declaration',
  },
};

export { Lang };
