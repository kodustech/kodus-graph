import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { log } from '../../shared/logger';
import { type LangConfig, LANG_CONFIGS } from '../languages';

// ---------------------------------------------------------------------------
// Go disambiguation helpers
// ---------------------------------------------------------------------------

/** Determine whether a Go `type_declaration` node is a struct, interface, or unknown. */
function goTypeKind(node: SgNode): 'struct' | 'interface' | null {
    const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
    if (!typeSpec) return null;
    const hasStruct = typeSpec.children().some((c) => c.kind() === 'struct_type');
    if (hasStruct) return 'struct';
    const hasInterface = typeSpec.children().some((c) => c.kind() === 'interface_type');
    if (hasInterface) return 'interface';
    return null;
}

/** Get the name for a Go `type_declaration` node (name lives inside `type_spec`). */
function goTypeName(node: SgNode): string | undefined {
    const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
    return typeSpec?.field('name')?.text();
}

// ---------------------------------------------------------------------------
// Test detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the function should be considered a test based on file-path
 * and function-name conventions defined in config.tests.
 *
 * File patterns and func patterns are independent OR conditions:
 * - If the file matches a filePattern → it's a test (regardless of func name)
 * - If the func name matches a funcPattern → it's a test (regardless of file name)
 *
 * Exception: Go requires BOTH filePattern AND funcPattern to match (reflected in
 * goConfig having both patterns where only their intersection are real tests).
 * Since Go is the only language that explicitly requires AND semantics and its
 * config already pairs the two patterns correctly, we handle it by checking
 * whether the language config has ONLY filePatterns (Ruby) or ONLY funcPatterns
 * (Java/Rust/C#) as pure checks, and treat having both as OR for all languages.
 */
function isTestByConvention(fp: string, funcName: string, config: LangConfig): boolean {
    const tests = config.tests;
    if (!tests) return false;

    const fileMatch = tests.filePatterns ? tests.filePatterns.some((re) => re.test(fp)) : false;
    const funcMatch = tests.funcPatterns ? tests.funcPatterns.some((re) => re.test(funcName)) : false;

    if (tests.filePatterns) {
        if (fileMatch) return true;
    }
    if (tests.funcPatterns) {
        if (funcMatch) return true;
    }
    return false;
}

/**
 * Returns true if the function node has an annotation/attribute sibling or
 * child that matches config.tests.annotationKind / annotationNames.
 */
function hasTestAnnotation(node: SgNode, config: LangConfig): boolean {
    const tests = config.tests;
    if (!tests?.annotationKind || !tests.annotationNames?.length) return false;

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
                        if (kind !== 'struct') continue; // interfaces handled separately below
                        const name = goTypeName(node);
                        if (!name || seen.has(`c:${fp}:${name}`)) continue;
                        seen.add(`c:${fp}:${name}`);
                        graph.classes.push({
                            name,
                            file: fp,
                            line_start: node.range().start.line,
                            line_end: node.range().end.line,
                            extends: '',
                            implements: [],
                            ast_kind: String(node.kind()),
                            qualified: `${fp}::${name}`,
                            content_hash: computeContentHash(node.text()),
                        });
                        continue;
                    }

                    const name = node.field('name')?.text();
                    if (!name || seen.has(`c:${fp}:${name}`)) continue;
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

                    graph.classes.push({
                        name,
                        file: fp,
                        line_start: node.range().start.line,
                        line_end: node.range().end.line,
                        extends: extendsVal,
                        implements: implementsVal,
                        ast_kind: String(node.kind()),
                        qualified: `${fp}::${name}`,
                        content_hash: computeContentHash(node.text()),
                    });
                }
            } catch (err) {
                log.debug('Generic class extraction failed', { file: fp, lang, error: String(err) });
            }
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
                        if (kind !== 'interface') continue;
                        const name = goTypeName(node);
                        if (!name || seen.has(`i:${fp}:${name}`)) continue;
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

                    const name = node.field('name')?.text();
                    if (!name || seen.has(`i:${fp}:${name}`)) continue;
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
                    const name = node.field('name')?.text();
                    if (!name || seen.has(`e:${fp}:${name}`)) continue;
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
    const funcKinds = [
        ...(config.function ?? []),
        ...(config.method ?? []),
        ...(config.constructorKinds ?? []),
    ];

    const constructorKindSet = new Set(config.constructorKinds ?? []);
    const methodKindSet = new Set(config.method ?? []);

    for (const funcKind of funcKinds) {
        try {
            for (const node of rootNode.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) continue;
                const line = node.range().start.line;
                if (seen.has(`f:${fp}:${name}:${line}`)) continue;
                seen.add(`f:${fp}:${name}:${line}`);

                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                const className = classAncestor?.field('name')?.text() || '';

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
                const isTest =
                    isTestByConvention(fp, name, config) || hasTestAnnotation(node, config);

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
                    if (!module) continue;
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
