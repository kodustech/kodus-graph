import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { log } from '../../shared/logger';
import { LANG_CONFIGS, type LangConfig } from '../languages';

// ---------------------------------------------------------------------------
// Go disambiguation helpers
// ---------------------------------------------------------------------------

/** Determine whether a Go `type_declaration` node is a struct, interface, or unknown. */
function goTypeKind(node: SgNode): 'struct' | 'interface' | null {
    const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
    if (!typeSpec) {
        return null;
    }
    const hasStruct = typeSpec.children().some((c) => c.kind() === 'struct_type');
    if (hasStruct) {
        return 'struct';
    }
    const hasInterface = typeSpec.children().some((c) => c.kind() === 'interface_type');
    if (hasInterface) {
        return 'interface';
    }
    return null;
}

/** Get the name for a Go `type_declaration` node (name lives inside `type_spec`). */
function goTypeName(node: SgNode): string | undefined {
    const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
    return typeSpec?.field('name')?.text();
}

// ---------------------------------------------------------------------------
// Kotlin disambiguation helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a Kotlin `class_declaration` node is a class, interface, or enum.
 * In Kotlin's tree-sitter grammar, all three share the `class_declaration` kind
 * and are distinguished by the presence of `interface` or `enum` child tokens.
 */
function kotlinClassKind(node: SgNode): 'class' | 'interface' | 'enum' {
    const children = node.children();
    if (children.some((c) => c.kind() === 'interface')) {
        return 'interface';
    }
    if (children.some((c) => c.kind() === 'enum')) {
        return 'enum';
    }
    return 'class';
}

/**
 * Get the name for a Kotlin `class_declaration` or `object_declaration` node.
 * Kotlin's tree-sitter grammar does not expose `field('name')` — the name
 * lives in a `type_identifier` child node instead.
 */
function kotlinTypeName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'type_identifier')
        ?.text();
}

/**
 * Get the name for a Kotlin `function_declaration` node.
 * The function name is a `simple_identifier` child (not exposed via `field('name')`).
 */
function kotlinFuncName(node: SgNode): string | undefined {
    return node
        .children()
        .find((c) => c.kind() === 'simple_identifier')
        ?.text();
}

// ---------------------------------------------------------------------------
// Test detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the function should be considered a test based on file-path
 * and function-name conventions defined in config.tests.
 *
 * matchMode controls how filePatterns and funcPatterns interact:
 * - 'and': BOTH must match (e.g., Go: file must be _test.go AND func must start with Test/Benchmark)
 * - 'or' (default): EITHER matching is sufficient
 */
function isTestByConvention(fp: string, funcName: string, config: LangConfig): boolean {
    const tests = config.tests;
    if (!tests) {
        return false;
    }

    const fileMatch = tests.filePatterns ? tests.filePatterns.some((re) => re.test(fp)) : false;
    const funcMatch = tests.funcPatterns ? tests.funcPatterns.some((re) => re.test(funcName)) : false;

    if (tests.matchMode === 'and') {
        // Both must match (or only the defined one must match)
        const fileOk = !tests.filePatterns || fileMatch;
        const funcOk = !tests.funcPatterns || funcMatch;
        return fileOk && funcOk;
    }

    // Default: OR — either matching is sufficient
    if (fileMatch) {
        return true;
    }
    if (funcMatch) {
        return true;
    }
    return false;
}

/**
 * Returns true if the function node has an annotation/attribute sibling or
 * child that matches config.tests.annotationKind / annotationNames.
 */
function hasTestAnnotation(node: SgNode, config: LangConfig): boolean {
    const tests = config.tests;
    if (!tests?.annotationKind || !tests.annotationNames?.length) {
        return false;
    }

    const annotationKind = tests.annotationKind;
    const annotationNames = tests.annotationNames;

    function textMatchesAnnotation(text: string): boolean {
        return annotationNames.some((name) => text.includes(name));
    }

    // Check previous siblings for annotation nodes
    for (const sibling of node.prevAll()) {
        if (sibling.kind() === annotationKind && textMatchesAnnotation(sibling.text())) {
            return true;
        }
    }

    // Check inside modifiers or attribute_list children of the function node
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'modifiers' || ck === 'attribute_list' || ck === annotationKind) {
            if (textMatchesAnnotation(child.text())) {
                return true;
            }
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Import extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract the module name from an import node using multiple strategies.
 */
function extractImportModule(node: SgNode): string {
    // Strategy 1: look for string literal children
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'string' || ck === 'interpreted_string_literal' || ck === 'string_fragment') {
            const raw = child.text();
            // Strip surrounding quotes
            return raw.replace(/^["'`]|["'`]$/g, '');
        }
        // Recurse into string children one level
        for (const grandchild of child.children()) {
            const gck = grandchild.kind();
            if (gck === 'string_fragment' || gck === 'string_content') {
                return grandchild.text();
            }
        }
    }

    // Strategy 2: scoped identifiers / qualified names
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'scoped_identifier' || ck === 'scoped_type_identifier' || ck === 'qualified_name') {
            return child.text();
        }
    }

    // Strategy 3: namespace names / use_tree (Rust `use` paths)
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'name' || ck === 'namespace_name' || ck === 'use_tree') {
            return child.text();
        }
    }

    // Strategy 4: identifier children as last resort
    for (const child of node.children()) {
        if (child.kind() === 'identifier' || child.kind() === 'type_identifier') {
            return child.text();
        }
    }

    // Fallback: strip import/use/using/require prefix from full text
    return node
        .text()
        .replace(/^\s*(import|use|using|require)\s+/i, '')
        .replace(/[;{}]/g, '')
        .trim();
}

/**
 * Extract imported names (symbols) from an import node.
 */
function extractImportNames(node: SgNode): string[] {
    const names: string[] = [];

    // Look for namespace_use_group (PHP), use_tree_list (Rust), etc.
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'identifier' || ck === 'type_identifier' || ck === 'name') {
            names.push(child.text());
        }
    }

    return names;
}

// ---------------------------------------------------------------------------
// Modifiers extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract the full modifiers string from a node, including annotations.
 * For Java, this finds the `modifiers` child and returns its text
 * (e.g., "@Service @Autowired public static").
 * For other languages with `modifiers` children, returns the text as-is.
 */
function extractModifiers(node: SgNode, lang: string): string {
    const modifiersNode = node.children().find((c) => c.kind() === 'modifiers');
    if (modifiersNode) {
        // Return the full modifiers text which includes annotations and access modifiers
        return modifiersNode.text().replace(/\s+/g, ' ').trim();
    }
    return '';
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractGeneric(root: SgRoot, fp: string, lang: string, seen: Set<string>, graph: RawGraph): void {
    const config: LangConfig | undefined = LANG_CONFIGS[lang];
    if (!config) {
        return;
    }
    const rootNode = root.root();

    // ── Classes / Structs ─────────────────────────────────────────────────
    if (config.class?.length) {
        for (const classKind of config.class) {
            try {
                for (const node of rootNode.findAll({ rule: { kind: classKind } })) {
                    // Go disambiguation: type_declaration is shared between struct and interface
                    if (lang === 'go' && classKind === 'type_declaration') {
                        const kind = goTypeKind(node);
                        if (kind !== 'struct') {
                            continue; // interfaces handled separately below
                        }
                        const name = goTypeName(node);
                        if (!name || seen.has(`c:${fp}:${name}`)) {
                            continue;
                        }
                        seen.add(`c:${fp}:${name}`);

                        // Go struct embedding: field_declaration with type but no name
                        let goExtends = '';
                        const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
                        const structType = typeSpec?.children().find((c) => c.kind() === 'struct_type');
                        if (structType) {
                            const fieldDeclList = structType
                                .children()
                                .find((c) => c.kind() === 'field_declaration_list');
                            if (fieldDeclList) {
                                for (const field of fieldDeclList.children()) {
                                    if (field.kind() !== 'field_declaration') continue;
                                    // Embedded field: has type but no explicit field name
                                    const fieldName = field.field('name');
                                    const fieldType = field.field('type');
                                    if (!fieldName && fieldType) {
                                        // Use the type_identifier text (handles both plain and pointer types)
                                        const typeId = field
                                            .children()
                                            .find((c) => c.kind() === 'type_identifier');
                                        if (typeId) {
                                            goExtends = typeId.text();
                                            break; // first embedded field becomes extends
                                        }
                                    }
                                }
                            }
                        }

                        graph.classes.push({
                            name,
                            file: fp,
                            line_start: node.range().start.line,
                            line_end: node.range().end.line,
                            extends: goExtends,
                            implements: [],
                            ast_kind: String(node.kind()),
                            qualified: `${fp}::${name}`,
                            content_hash: computeContentHash(node.text()),
                        });
                        continue;
                    }

                    // Kotlin disambiguation: class_declaration is shared among class, interface, and enum.
                    // Only pick actual classes here (interfaces/enums handled in their own sections).
                    if (lang === 'kotlin' && classKind === 'class_declaration') {
                        const ktKind = kotlinClassKind(node);
                        if (ktKind !== 'class') {
                            continue; // interfaces and enums handled separately below
                        }
                    }

                    // Kotlin does not expose field('name'); use type_identifier child instead
                    const name = lang === 'kotlin' ? kotlinTypeName(node) : node.field('name')?.text();
                    if (!name || seen.has(`c:${fp}:${name}`)) {
                        continue;
                    }
                    seen.add(`c:${fp}:${name}`);

                    // Heritage extraction
                    let extendsVal = '';
                    let implementsVal: string[] = [];

                    if (config.heritage?.extends) {
                        const raw = config.heritage.extends(node);
                        if (typeof raw === 'string') {
                            extendsVal = raw;
                        } else if (Array.isArray(raw) && raw.length > 0) {
                            extendsVal = raw[0];
                        }
                    }

                    if (config.heritage?.implements) {
                        const raw = config.heritage.implements(node);
                        if (typeof raw === 'string') {
                            implementsVal = [raw];
                        } else if (Array.isArray(raw)) {
                            implementsVal = raw;
                        }
                    }

                    // Modifiers extraction (includes annotations for Java, access modifiers, etc.)
                    const classModifiers = extractModifiers(node, lang);

                    graph.classes.push({
                        name,
                        file: fp,
                        line_start: node.range().start.line,
                        line_end: node.range().end.line,
                        extends: extendsVal,
                        implements: implementsVal,
                        ast_kind: String(node.kind()),
                        qualified: `${fp}::${name}`,
                        modifiers: classModifiers || undefined,
                        content_hash: computeContentHash(node.text()),
                    });
                }
            } catch (err) {
                log.debug('Generic class extraction failed', { file: fp, lang, error: String(err) });
            }
        }
    }

    // ── Rust: impl Trait for Struct → implements relationship ──────────────
    if (lang === 'rust') {
        try {
            for (const implNode of rootNode.findAll({ rule: { kind: 'impl_item' } })) {
                const traitName = implNode.field('trait')?.text();
                const typeName = implNode.field('type')?.text();
                if (traitName && typeName) {
                    const structClass = graph.classes.find((c) => c.file === fp && c.name === typeName);
                    if (structClass && !structClass.implements.includes(traitName)) {
                        structClass.implements.push(traitName);
                    }
                }
            }
        } catch (err) {
            log.debug('Rust impl-trait extraction failed', { file: fp, lang, error: String(err) });
        }
    }

    // ── Interfaces / Traits ───────────────────────────────────────────────
    if (config.interface?.length) {
        for (const ifaceKind of config.interface) {
            try {
                for (const node of rootNode.findAll({ rule: { kind: ifaceKind } })) {
                    // Go disambiguation: type_declaration shared with class — only pick interface_type
                    if (lang === 'go' && ifaceKind === 'type_declaration') {
                        const kind = goTypeKind(node);
                        if (kind !== 'interface') {
                            continue;
                        }
                        const name = goTypeName(node);
                        if (!name || seen.has(`i:${fp}:${name}`)) {
                            continue;
                        }
                        seen.add(`i:${fp}:${name}`);
                        graph.interfaces.push({
                            name,
                            file: fp,
                            line_start: node.range().start.line,
                            line_end: node.range().end.line,
                            methods: [],
                            ast_kind: String(node.kind()),
                            qualified: `${fp}::${name}`,
                            content_hash: computeContentHash(node.text()),
                        });
                        continue;
                    }

                    // Kotlin disambiguation: only pick interface declarations
                    if (lang === 'kotlin' && ifaceKind === 'class_declaration') {
                        const ktKind = kotlinClassKind(node);
                        if (ktKind !== 'interface') {
                            continue;
                        }
                    }

                    // Kotlin does not expose field('name'); use type_identifier child instead
                    const name = lang === 'kotlin' ? kotlinTypeName(node) : node.field('name')?.text();
                    if (!name || seen.has(`i:${fp}:${name}`)) {
                        continue;
                    }
                    seen.add(`i:${fp}:${name}`);
                    graph.interfaces.push({
                        name,
                        file: fp,
                        line_start: node.range().start.line,
                        line_end: node.range().end.line,
                        methods: [],
                        ast_kind: String(node.kind()),
                        qualified: `${fp}::${name}`,
                        content_hash: computeContentHash(node.text()),
                    });
                }
            } catch (err) {
                log.debug('Generic interface extraction failed', { file: fp, lang, error: String(err) });
            }
        }
    }

    // ── Enums ─────────────────────────────────────────────────────────────
    if (config.enum?.length) {
        for (const enumKind of config.enum) {
            try {
                for (const node of rootNode.findAll({ rule: { kind: enumKind } })) {
                    // Kotlin disambiguation: only pick enum declarations
                    if (lang === 'kotlin' && enumKind === 'class_declaration') {
                        const ktKind = kotlinClassKind(node);
                        if (ktKind !== 'enum') {
                            continue;
                        }
                    }

                    // Kotlin does not expose field('name'); use type_identifier child instead
                    const name = lang === 'kotlin' ? kotlinTypeName(node) : node.field('name')?.text();
                    if (!name || seen.has(`e:${fp}:${name}`)) {
                        continue;
                    }
                    seen.add(`e:${fp}:${name}`);
                    graph.enums.push({
                        name,
                        file: fp,
                        line_start: node.range().start.line,
                        line_end: node.range().end.line,
                        ast_kind: String(node.kind()),
                        qualified: `${fp}::${name}`,
                        content_hash: computeContentHash(node.text()),
                    });
                }
            } catch (err) {
                log.debug('Generic enum extraction failed', { file: fp, lang, error: String(err) });
            }
        }
    }

    // ── Functions / Methods / Constructors ────────────────────────────────
    const funcKinds = [...(config.function ?? []), ...(config.method ?? []), ...(config.constructorKinds ?? [])];

    const constructorKindSet = new Set(config.constructorKinds ?? []);
    const methodKindSet = new Set(config.method ?? []);

    for (const funcKind of funcKinds) {
        try {
            for (const node of rootNode.findAll({ rule: { kind: funcKind } })) {
                // Kotlin does not expose field('name'); use simple_identifier child instead
                const name = lang === 'kotlin' ? kotlinFuncName(node) : node.field('name')?.text();
                if (!name) {
                    continue;
                }
                const line = node.range().start.line;
                if (seen.has(`f:${fp}:${name}:${line}`)) {
                    continue;
                }
                seen.add(`f:${fp}:${name}:${line}`);

                let className = '';

                // Go methods: extract className from receiver parameter
                if (lang === 'go' && node.kind() === 'method_declaration') {
                    const receiver = node.field('receiver');
                    if (receiver) {
                        // receiver is a parameter_list: "(s *UserService)" or "(s UserService)"
                        // Find type_identifier inside (handles both pointer and non-pointer receivers)
                        for (const child of receiver.children()) {
                            if (child.kind() === 'parameter_declaration') {
                                for (const gc of child.children()) {
                                    if (gc.kind() === 'type_identifier') {
                                        className = gc.text();
                                        break;
                                    }
                                    // pointer receiver: *UserService → pointer_type → type_identifier
                                    if (gc.kind() === 'pointer_type') {
                                        for (const pt of gc.children()) {
                                            if (pt.kind() === 'type_identifier') {
                                                className = pt.text();
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (className) break;
                            }
                        }
                    }
                }

                // Rust: extract className from enclosing impl block
                if (!className && lang === 'rust') {
                    const implAncestor = node.ancestors().find((a: SgNode) => a.kind() === 'impl_item');
                    if (implAncestor) {
                        // field('type') gives the concrete type: impl Type { } or impl Trait for Type { }
                        className = implAncestor.field('type')?.text() || '';
                    }
                }

                // For non-Go, non-Rust (or Go function_declaration), use ancestor lookup
                if (!className && lang !== 'rust') {
                    const classAncestor = node.ancestors().find((a: SgNode) => {
                        const k = String(a.kind());
                        // Kotlin: match specific declaration kinds to avoid matching class_body
                        if (lang === 'kotlin') {
                            return k === 'class_declaration' || k === 'object_declaration';
                        }
                        return k.includes('class') || k.includes('struct') || k.includes('impl');
                    });
                    // Kotlin doesn't expose field('name') — use type_identifier child instead
                    if (classAncestor) {
                        className =
                            lang === 'kotlin'
                                ? kotlinTypeName(classAncestor) || ''
                                : classAncestor.field('name')?.text() || '';
                    }
                }

                // Determine function kind
                let kind: 'Function' | 'Method' | 'Constructor';
                if (constructorKindSet.has(funcKind)) {
                    kind = 'Constructor';
                } else if (methodKindSet.has(funcKind) || className) {
                    kind = 'Method';
                } else {
                    kind = 'Function';
                }

                // Test detection
                const isTest = isTestByConvention(fp, name, config) || hasTestAnnotation(node, config);

                if (isTest) {
                    // Push to graph.tests
                    const testKey = `t:${fp}:${name}:${line}`;
                    if (!seen.has(testKey)) {
                        seen.add(testKey);
                        graph.tests.push({
                            name,
                            file: fp,
                            line_start: line,
                            line_end: node.range().end.line,
                            ast_kind: String(node.kind()),
                            qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
                            content_hash: computeContentHash(node.text()),
                        });
                    }
                    // Also push to functions so call resolution still works
                }

                // Modifiers extraction (includes annotations for Java, access modifiers, etc.)
                const funcModifiers = extractModifiers(node, lang);

                graph.functions.push({
                    name,
                    file: fp,
                    line_start: line,
                    line_end: node.range().end.line,
                    params: node.field('parameters')?.text() || '()',
                    returnType: node.field('return_type')?.text() || '',
                    kind,
                    ast_kind: String(node.kind()),
                    className,
                    qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
                    modifiers: funcModifiers || undefined,
                    content_hash: computeContentHash(node.text()),
                });
            }
        } catch (err) {
            log.debug('Generic function extraction failed', { file: fp, lang, error: String(err) });
        }
    }

    // ── Imports ───────────────────────────────────────────────────────────
    if (config.import?.length) {
        for (const importKind of config.import) {
            try {
                for (const node of rootNode.findAll({ rule: { kind: importKind } })) {
                    const module = extractImportModule(node);
                    if (!module) {
                        continue;
                    }
                    graph.imports.push({
                        module,
                        file: fp,
                        line: node.range().start.line,
                        names: extractImportNames(node),
                        lang,
                    });
                }
            } catch (err) {
                log.debug('Generic import extraction failed', { file: fp, lang, error: String(err) });
            }
        }
    }
}

/** Shared class-finder for languages using class/struct/impl AST kinds. */
function findEnclosingClassGeneric(node: import('@ast-grep/napi').SgNode): import('@ast-grep/napi').SgNode | null {
    return (
        node.ancestors().find((a) => {
            const k = String(a.kind());
            return k.includes('class') || k.includes('struct') || k.includes('impl');
        }) ?? null
    );
}

/** Per-language call extraction configs for self/super detection. */
const GENERIC_CONFIGS: Record<string, CallExtractionConfig> = {
    java: {
        selfPrefixes: ['this.'],
        superPrefixes: ['super.'],
        findEnclosingClass: findEnclosingClassGeneric,
        getParentClass: (classNode) => {
            const sc = classNode.children().find((c) => c.kind() === 'superclass');
            return sc
                ?.children()
                .find((c) => c.kind() === 'type_identifier')
                ?.text();
        },
    },
    csharp: {
        selfPrefixes: ['this.'],
        superPrefixes: ['base.'],
        findEnclosingClass: findEnclosingClassGeneric,
        getParentClass: (classNode) => {
            const bl = classNode.children().find((c) => c.kind() === 'base_list');
            return bl
                ?.children()
                .find((c) => c.kind() === 'identifier' || c.kind() === 'type_identifier')
                ?.text();
        },
    },
    rust: {
        selfPrefixes: ['self.'],
        superPrefixes: [],
        findEnclosingClass: (node) => node.ancestors().find((a) => a.kind() === 'impl_item') ?? null,
    },
    go: {
        selfPrefixes: [],
        superPrefixes: [],
        findEnclosingClass: findEnclosingClassGeneric,
    },
    php: {
        selfPrefixes: ['$this->'],
        superPrefixes: ['parent::'],
        findEnclosingClass: findEnclosingClassGeneric,
    },
    kotlin: {
        selfPrefixes: ['this.'],
        superPrefixes: ['super.'],
        findEnclosingClass: findEnclosingClassGeneric,
        getParentClass: (classNode) => {
            // Kotlin delegation_specifier with constructor_invocation = superclass
            const delegations = classNode.children().filter((c) => c.kind() === 'delegation_specifier');
            for (const d of delegations) {
                const ctorInvocation = d.children().find((c) => c.kind() === 'constructor_invocation');
                if (ctorInvocation) {
                    const userType = ctorInvocation.children().find((c) => c.kind() === 'user_type');
                    return userType?.children().find((c) => c.kind() === 'type_identifier')?.text();
                }
            }
            return undefined;
        },
    },
};

/** Fallback config for unknown languages — no self/super detection. */
const FALLBACK_CONFIG: CallExtractionConfig = {
    selfPrefixes: [],
    superPrefixes: [],
    findEnclosingClass: findEnclosingClassGeneric,
};

/**
 * Extract raw call sites from a generic language AST.
 * Uses per-language config for self/super detection.
 */
export function extractCallsFromGeneric(root: SgRoot, fp: string, lang: string, calls: RawCallSite[]): void {
    const config = GENERIC_CONFIGS[lang] ?? FALLBACK_CONFIG;
    extractCalls(root.root(), fp, config, calls);
}
