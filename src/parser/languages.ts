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
import type { SgNode } from '@ast-grep/napi';
import { Lang, registerDynamicLanguage } from '@ast-grep/napi';

// Register dynamic languages at import time (side effect).
// This must happen before parseAsync can parse these languages.
registerDynamicLanguage({ python, ruby, go, java, rust, php, csharp, kotlin, swift, dart, scala, c, cpp, elixir });

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
    class: ['struct_item'],
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

const kotlinConfig: LangConfig = {
    // Kotlin uses class_declaration for classes, interfaces, and enums.
    // Disambiguation is handled in the generic extractor using child node checks
    // (similar to how Go disambiguates struct vs interface in type_declaration).
    class: ['class_declaration', 'object_declaration'],
    interface: ['class_declaration'],
    // Kotlin uses function_declaration for both methods and top-level functions.
    // We list it only in 'function' and rely on className-based detection to
    // promote to Method kind (same approach Go uses with method_declaration/function_declaration).
    function: ['function_declaration'],
    enum: ['class_declaration'],
    import: ['import_header'],
    heritage: {
        extends: (node: SgNode) => {
            // In Kotlin, delegation_specifier with constructor_invocation = superclass call
            const delegations = node.children().filter((c: SgNode) => c.kind() === 'delegation_specifier');
            for (const d of delegations) {
                const ctorInvocation = d.children().find((c: SgNode) => c.kind() === 'constructor_invocation');
                if (ctorInvocation) {
                    const userType = ctorInvocation.children().find((c: SgNode) => c.kind() === 'user_type');
                    const typeId = userType?.children().find((c: SgNode) => c.kind() === 'type_identifier');
                    if (typeId) {
                        return typeId.text();
                    }
                }
            }
            return undefined;
        },
        implements: (node: SgNode) => {
            // In Kotlin, delegation_specifier with just user_type (no constructor_invocation) = interface
            const delegations = node.children().filter((c: SgNode) => c.kind() === 'delegation_specifier');
            const interfaces: string[] = [];
            for (const d of delegations) {
                const hasCtorInvocation = d.children().some((c: SgNode) => c.kind() === 'constructor_invocation');
                if (!hasCtorInvocation) {
                    const userType = d.children().find((c: SgNode) => c.kind() === 'user_type');
                    const typeId = userType?.children().find((c: SgNode) => c.kind() === 'type_identifier');
                    if (typeId) {
                        interfaces.push(typeId.text());
                    }
                }
            }
            return interfaces;
        },
    },
    tests: {
        filePatterns: [/test/i],
        funcPatterns: [/^test/i],
        annotationKind: 'annotation',
        annotationNames: ['Test', 'ParameterizedTest'],
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
            // PHP base_clause child is `name` for simple names, `qualified_name` for namespaced ones
            const name = baseClause
                .children()
                .find((c: SgNode) => c.kind() === 'name' || c.kind() === 'qualified_name');
            return name?.text();
        },
        implements: (node: SgNode) => {
            const ifaceClause = node.children().find((c: SgNode) => c.kind() === 'class_interface_clause');
            if (!ifaceClause) {
                return undefined;
            }
            return ifaceClause
                .children()
                .filter((c: SgNode) => c.kind() === 'name' || c.kind() === 'qualified_name')
                .map((c: SgNode) => c.text());
        },
    },
    tests: {
        funcPatterns: [/^test/],
        filePatterns: [/Test\.php$/],
    },
};

const dartConfig: LangConfig = {
    class: ['class_definition', 'mixin_declaration'],
    function: ['function_signature'],
    method: ['method_signature'],
    constructorKinds: ['constructor_signature'],
    interface: ['class_definition'], // abstract classes act as interfaces in Dart
    enum: ['enum_declaration'],
    import: ['import_or_export'],
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
            const interfaces = node.children().find((c: SgNode) => c.kind() === 'interfaces');
            if (!interfaces) {
                return [];
            }
            return interfaces
                .children()
                .filter((c: SgNode) => c.kind() === 'type_identifier')
                .map((c: SgNode) => c.text());
        },
    },
    tests: {
        filePatterns: [/_test\.dart$/, /test_.*\.dart$/],
        funcPatterns: [/^test/],
    },
};

const cConfig: LangConfig = {
    // C uses struct_specifier for structs and type_definition for typedef'd structs
    class: ['struct_specifier'],
    function: ['function_definition'],
    enum: ['enum_specifier'],
    import: ['preproc_include'],
};

const elixirConfig: LangConfig = {
    // In Elixir's tree-sitter grammar, everything is a `call` node.
    // defmodule, def, defp, use, alias, import are all call nodes
    // distinguished by the identifier target text.
    // Module attributes (@behaviour, @callback) are unary_operator nodes.
    // The dedicated extractor handles all disambiguation.
    class: ['call'], // defmodule calls
    function: ['call'], // def/defp calls
    interface: ['call'], // defmodule with @callback attributes
    import: ['call'], // use/alias/import calls
    tests: {
        filePatterns: [/_test\.exs$/, /test_.*\.exs$/],
        funcPatterns: [/^test[\s_]/],
    },
};

const cppConfig: LangConfig = {
    class: ['class_specifier', 'struct_specifier'],
    function: ['function_definition'],
    interface: [], // C++ doesn't have a distinct interface keyword; pure virtual classes serve as interfaces
    enum: ['enum_specifier'],
    import: ['preproc_include'],
    heritage: {
        extends: (node: SgNode) => {
            const baseClause = node.children().find((c: SgNode) => c.kind() === 'base_class_clause');
            if (!baseClause) {
                return undefined;
            }
            // First type_identifier after base_class_clause is the primary base class
            const typeIds = baseClause.children().filter((c: SgNode) => c.kind() === 'type_identifier');
            return typeIds.length > 0 ? typeIds[0].text() : undefined;
        },
        implements: (node: SgNode) => {
            const baseClause = node.children().find((c: SgNode) => c.kind() === 'base_class_clause');
            if (!baseClause) {
                return [];
            }
            // All type_identifiers after the first are treated as additional bases (interfaces)
            const typeIds = baseClause.children().filter((c: SgNode) => c.kind() === 'type_identifier');
            return typeIds.slice(1).map((c: SgNode) => c.text());
        },
    },
};

const scalaConfig: LangConfig = {
    class: ['class_definition', 'object_definition'],
    interface: ['trait_definition'],
    function: ['function_definition', 'function_declaration'],
    import: ['import_declaration'],
    heritage: {
        extends: (node: SgNode) => {
            const extendsClause = node.children().find((c: SgNode) => c.kind() === 'extends_clause');
            if (!extendsClause) {
                return undefined;
            }
            const typeId = extendsClause.children().find((c: SgNode) => c.kind() === 'type_identifier');
            return typeId?.text();
        },
        implements: (node: SgNode) => {
            const extendsClause = node.children().find((c: SgNode) => c.kind() === 'extends_clause');
            if (!extendsClause) {
                return [];
            }
            const traits: string[] = [];
            let afterWith = false;
            for (const child of extendsClause.children()) {
                if (child.kind() === 'with') {
                    afterWith = true;
                    continue;
                }
                if (afterWith && child.kind() === 'type_identifier') {
                    traits.push(child.text());
                    afterWith = false;
                }
            }
            return traits;
        },
    },
    tests: {
        filePatterns: [/Test\.scala$/, /Spec\.scala$/, /Suite\.scala$/, /test/i],
        funcPatterns: [/^test/i],
    },
};

const swiftConfig: LangConfig = {
    // Swift uses class_declaration for classes, structs, and enums.
    // Disambiguation is handled in the extractor using child node checks
    // (similar to how Kotlin disambiguates class vs interface vs enum).
    class: ['class_declaration'],
    interface: ['protocol_declaration'],
    function: ['function_declaration'],
    constructorKinds: ['init_declaration'],
    enum: ['class_declaration'],
    import: ['import_declaration'],
    heritage: {
        extends: (node: SgNode) => {
            // Only classes can have superclasses in Swift
            const children = node.children();
            if (children.some((c) => c.kind() === 'struct') || children.some((c) => c.kind() === 'enum')) {
                return undefined;
            }
            const specifiers = children.filter((c) => c.kind() === 'inheritance_specifier');
            if (specifiers.length === 0) {
                return undefined;
            }
            const first = specifiers[0];
            const userType = first.children().find((c: SgNode) => c.kind() === 'user_type');
            const typeId = userType?.children().find((c: SgNode) => c.kind() === 'type_identifier');
            return typeId?.text();
        },
        implements: (node: SgNode) => {
            const children = node.children();
            const isClass = !children.some((c) => c.kind() === 'struct') && !children.some((c) => c.kind() === 'enum');
            const specifiers = children.filter((c) => c.kind() === 'inheritance_specifier');
            if (specifiers.length === 0) {
                return [];
            }
            // For classes, skip the first (superclass). For structs, all are protocols.
            const startIdx = isClass && specifiers.length > 1 ? 1 : 0;
            if (isClass && specifiers.length === 1) {
                return [];
            }
            const protocols: string[] = [];
            for (let i = startIdx; i < specifiers.length; i++) {
                const userType = specifiers[i].children().find((c: SgNode) => c.kind() === 'user_type');
                const typeId = userType?.children().find((c: SgNode) => c.kind() === 'type_identifier');
                if (typeId) {
                    protocols.push(typeId.text());
                }
            }
            return protocols;
        },
    },
    tests: {
        filePatterns: [/Tests?\.swift$/, /test/i],
        funcPatterns: [/^test/i],
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
    kotlin: kotlinConfig,
    swift: swiftConfig,
    dart: dartConfig,
    scala: scalaConfig,
    c: cConfig,
    cpp: cppConfig,
    elixir: elixirConfig,
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
        // biome-ignore lint/complexity/useLiteralKeys: bracket notation required — dot notation resolves to Function.prototype.constructor (TS2322)
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
    kotlin: {
        ...derivedKinds(kotlinConfig),
        annotation: 'annotation',
        object: 'object_declaration',
        companionObject: 'companion_object',
    },
    swift: {
        ...derivedKinds(swiftConfig),
        protocol: 'protocol_declaration',
        attribute: 'attribute',
        initDecl: 'init_declaration',
    },
    dart: {
        ...derivedKinds(dartConfig),
        mixin: 'mixin_declaration',
        markerAnnotation: 'marker_annotation',
        annotation: 'annotation',
        extension: 'extension_declaration',
    },
    scala: {
        ...derivedKinds(scalaConfig),
        trait: 'trait_definition',
        object: 'object_definition',
        annotation: 'annotation',
    },
    c: {
        ...derivedKinds(cConfig),
        typedef: 'type_definition',
        include: 'preproc_include',
    },
    cpp: {
        ...derivedKinds(cppConfig),
        namespace: 'namespace_definition',
        template: 'template_declaration',
        include: 'preproc_include',
    },
    elixir: {
        ...derivedKinds(elixirConfig),
        call: 'call',
        unaryOperator: 'unary_operator',
        alias: 'alias',
        dot: 'dot',
    },
};

export { Lang };
