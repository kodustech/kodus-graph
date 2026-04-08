import csharp from '@ast-grep/lang-csharp';
import go from '@ast-grep/lang-go';
import java from '@ast-grep/lang-java';
import php from '@ast-grep/lang-php';
import python from '@ast-grep/lang-python';
import ruby from '@ast-grep/lang-ruby';
import rust from '@ast-grep/lang-rust';
import type { SgNode } from '@ast-grep/napi';
import { Lang, registerDynamicLanguage } from '@ast-grep/napi';

// Register dynamic languages at import time (side effect).
// This must happen before parseAsync can parse these languages.
registerDynamicLanguage({ python, ruby, go, java, rust, php, csharp });

// ---------------------------------------------------------------------------
// LangConfig types
// ---------------------------------------------------------------------------

export type HeritageFinder = (node: SgNode) => string | string[] | undefined;

export interface TestConfig {
    filePatterns?: RegExp[];
    funcPatterns?: RegExp[];
    /** When both filePatterns and funcPatterns are set: 'and' requires both, 'or' (default) requires either */
    matchMode?: 'and' | 'or';
    annotationKind?: string;
    annotationNames?: string[];
}

export interface LangConfig {
    class?: string[];
    function?: string[];
    method?: string[];
    // NOTE: named 'constructorKinds' internally to avoid collision with
    // Function.prototype.constructor; exposed as 'constructor' in LANG_CONFIGS
    // via the type alias below.
    constructorKinds?: string[];
    interface?: string[];
    enum?: string[];
    import?: string[];
    heritage?: {
        extends?: HeritageFinder;
        implements?: HeritageFinder;
    };
    tests?: TestConfig;
}

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

export function isTypeScriptLike(lang: Lang | string): boolean {
    return lang === Lang.TypeScript || lang === Lang.Tsx || lang === Lang.JavaScript;
}

// ---------------------------------------------------------------------------
// Per-language LangConfig definitions
// ---------------------------------------------------------------------------

const typescriptConfig: LangConfig = {
    class: ['class_declaration', 'abstract_class_declaration'],
    method: ['method_definition'],
    function: ['function_declaration'],
    interface: ['interface_declaration'],
    enum: ['enum_declaration'],
    import: ['import_statement'],
};

const pythonConfig: LangConfig = {
    class: ['class_definition'],
    method: ['function_definition'],
    function: ['function_definition'],
    import: ['import_from_statement', 'import_statement'],
    tests: {
        funcPatterns: [/^test_/],
        filePatterns: [/test_.*\.py$/, /_test\.py$/],
    },
};

const rubyConfig: LangConfig = {
    class: ['class'],
    method: ['method', 'singleton_method'],
    import: [],
    tests: {
        filePatterns: [/_spec\.rb$/, /spec_.*\.rb$/],
    },
};

const goConfig: LangConfig = {
    function: ['function_declaration'],
    method: ['method_declaration'],
    class: ['type_declaration'],
    interface: ['type_declaration'],
    import: ['import_declaration'],
    tests: {
        filePatterns: [/_test\.go$/],
        funcPatterns: [/^Test/, /^Benchmark/],
        matchMode: 'and',
    },
};

const javaConfig: LangConfig = {
    class: ['class_declaration'],
    interface: ['interface_declaration'],
    method: ['method_declaration'],
    constructorKinds: ['constructor_declaration'],
    import: ['import_declaration'],
    enum: ['enum_declaration'],
    heritage: {
        extends: (node: SgNode) => {
            const superclass = node.children().find((c: SgNode) => c.kind() === 'superclass');
            if (!superclass) {
                return undefined;
            }
            const typeId = superclass.children().find((c: SgNode) => c.kind() === 'type_identifier');
            return typeId?.text();
        },
        implements: (node: SgNode) => {
            const superInterfaces = node.children().find((c: SgNode) => c.kind() === 'super_interfaces');
            if (!superInterfaces) {
                return [];
            }
            // type_identifiers may be direct children or nested in a type_list
            const typeList = superInterfaces.children().find((c: SgNode) => c.kind() === 'type_list');
            const container = typeList || superInterfaces;
            return container
                .children()
                .filter((c: SgNode) => c.kind() === 'type_identifier')
                .map((c: SgNode) => c.text());
        },
    },
    tests: {
        annotationKind: 'marker_annotation',
        annotationNames: ['Test', 'ParameterizedTest'],
    },
};

const rustConfig: LangConfig = {
    function: ['function_item'],
    class: ['struct_item', 'impl_item'],
    interface: ['trait_item'],
    enum: ['enum_item'],
    import: ['use_declaration'],
    tests: {
        annotationKind: 'attribute_item',
        annotationNames: ['test'],
    },
};

const csharpConfig: LangConfig = {
    class: ['class_declaration'],
    interface: ['interface_declaration'],
    method: ['method_declaration'],
    constructorKinds: ['constructor_declaration'],
    import: ['using_directive'],
    enum: ['enum_declaration'],
    heritage: {
        // C# base_list doesn't distinguish extends vs implements syntactically.
        // Heuristic: names starting with 'I' + uppercase are interfaces (C# convention).
        // First non-interface type is treated as the base class.
        extends: (node: SgNode) => {
            const baseList = node.children().find((c: SgNode) => c.kind() === 'base_list');
            if (!baseList) {
                return undefined;
            }
            const types = baseList
                .children()
                .filter((c: SgNode) => c.kind() === 'type_identifier' || c.kind() === 'identifier')
                .map((c: SgNode) => c.text());
            // First non-interface name is the base class
            return types.find((t) => !(t.length >= 2 && t[0] === 'I' && t[1] === t[1].toUpperCase()));
        },
        implements: (node: SgNode) => {
            const baseList = node.children().find((c: SgNode) => c.kind() === 'base_list');
            if (!baseList) {
                return undefined;
            }
            const types = baseList
                .children()
                .filter((c: SgNode) => c.kind() === 'type_identifier' || c.kind() === 'identifier')
                .map((c: SgNode) => c.text());
            // Names matching I+uppercase convention are interfaces
            return types.filter((t) => t.length >= 2 && t[0] === 'I' && t[1] === t[1].toUpperCase());
        },
    },
    tests: {
        annotationKind: 'attribute',
        annotationNames: ['TestMethod', 'Fact', 'Test', 'Theory'],
    },
};

const phpConfig: LangConfig = {
    class: ['class_declaration'],
    interface: ['interface_declaration'],
    method: ['method_declaration'],
    function: ['function_definition'],
    import: ['namespace_use_declaration'],
    heritage: {
        extends: (node: SgNode) => {
            const baseClause = node.children().find((c: SgNode) => c.kind() === 'base_clause');
            if (!baseClause) {
                return undefined;
            }
            const name = baseClause.children().find((c: SgNode) => c.kind() === 'name');
            return name?.text();
        },
        implements: (node: SgNode) => {
            const ifaceClause = node.children().find((c: SgNode) => c.kind() === 'class_interface_clause');
            if (!ifaceClause) {
                return undefined;
            }
            return ifaceClause
                .children()
                .filter((c: SgNode) => c.kind() === 'name')
                .map((c: SgNode) => c.text());
        },
    },
    tests: {
        funcPatterns: [/^test/],
        filePatterns: [/Test\.php$/],
    },
};

// ---------------------------------------------------------------------------
// LANG_CONFIGS export
// ---------------------------------------------------------------------------

export const LANG_CONFIGS: Record<string, LangConfig> = {
    typescript: typescriptConfig,
    python: pythonConfig,
    ruby: rubyConfig,
    go: goConfig,
    java: javaConfig,
    rust: rustConfig,
    csharp: csharpConfig,
    php: phpConfig,
};

// ---------------------------------------------------------------------------
// Backward-compat LANG_KINDS derived from LANG_CONFIGS
// (used by the dedicated typescript.ts, python.ts, ruby.ts extractors)
// Takes the first element of each array to match the old single-string format,
// then merges in language-specific extras.
// ---------------------------------------------------------------------------

function firstOf(arr: string[] | undefined): string | undefined {
    return arr?.[0];
}

function derivedKinds(config: LangConfig): Record<string, string> {
    const result: Record<string, string> = {};
    if (firstOf(config.class)) {
        result.class = firstOf(config.class)!;
    }
    if (firstOf(config.function)) {
        result.function = firstOf(config.function)!;
    }
    if (firstOf(config.method)) {
        result.method = firstOf(config.method)!;
    }
    if (firstOf(config.constructorKinds)) {
        result['constructor'] = firstOf(config.constructorKinds)!;
    }
    if (firstOf(config.interface)) {
        result.interface = firstOf(config.interface)!;
    }
    if (firstOf(config.enum)) {
        result.enum = firstOf(config.enum)!;
    }
    if (firstOf(config.import)) {
        result.import = firstOf(config.import)!;
    }
    return result;
}

export const LANG_KINDS: Record<string, Record<string, string>> = {
    typescript: {
        ...derivedKinds(typescriptConfig),
        abstractClass: 'abstract_class_declaration',
        arrowContainer: 'variable_declarator',
        arrowFunction: 'arrow_function',
        export: 'export_statement',
        methodSignature: 'method_signature',
    },
    python: {
        ...derivedKinds(pythonConfig),
        importRegular: 'import_statement',
        decorator: 'decorator',
    },
    ruby: {
        ...derivedKinds(rubyConfig),
        module: 'module',
        singletonMethod: 'singleton_method',
        call: 'call',
    },
    go: {
        ...derivedKinds(goConfig),
        struct: 'type_declaration',
    },
    java: {
        ...derivedKinds(javaConfig),
        annotation: 'marker_annotation',
    },
    rust: {
        ...derivedKinds(rustConfig),
        impl: 'impl_item',
        struct: 'struct_item',
        trait: 'trait_item',
        use: 'use_declaration',
    },
    csharp: {
        ...derivedKinds(csharpConfig),
        using: 'using_directive',
        attribute: 'attribute',
    },
    php: {
        ...derivedKinds(phpConfig),
        namespace: 'namespace_use_declaration',
    },
};

export { Lang };
