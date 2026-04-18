import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import { computeContentHash, emptyResult, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { C_NOISE } from './noise';

// Branch kinds for C / C++ cyclomatic complexity.
// `case_statement` is the case-level kind (also used for `default:`).
// `if_statement` alone covers `else if` (nested if_statement in `else_clause`);
// including `else_clause` would double-count. `catch_clause` is C++-only
// (C has no exceptions) but harmless to list for both since it just won't
// match in C code.
const C_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'while_statement',
    'do_statement',
    'case_statement',
    'conditional_expression',
    'catch_clause',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine if a file is a header file (declarations are implicitly "exported").
 */
function isHeaderFile(fp: string): boolean {
    return /\.(h|hpp|hh)$/.test(fp);
}

/**
 * Extract the function name from a function_definition node.
 * For C: function_declarator > identifier
 * For C++: function_declarator > identifier or field_identifier
 * Also handles pointer return types where declarator is nested in pointer_declarator.
 */
function extractFuncName(node: SgNode): string | undefined {
    // Direct: function_declarator child
    const declarator = findFunctionDeclarator(node);
    if (!declarator) {
        return undefined;
    }

    // C uses identifier, C++ methods use field_identifier
    const id =
        declarator.children().find((c) => c.kind() === 'identifier') ||
        declarator.children().find((c) => c.kind() === 'field_identifier');
    return id?.text();
}

/**
 * Find the function_declarator node, which may be nested inside a pointer_declarator
 * or reference_declarator for functions returning pointers/references.
 */
function findFunctionDeclarator(node: SgNode): SgNode | undefined {
    // Direct child
    const direct = node.children().find((c) => c.kind() === 'function_declarator');
    if (direct) {
        return direct;
    }

    // Nested inside pointer_declarator or reference_declarator (e.g., `int* foo()`)
    for (const child of node.children()) {
        if (child.kind() === 'pointer_declarator' || child.kind() === 'reference_declarator') {
            const nested = child.children().find((c) => c.kind() === 'function_declarator');
            if (nested) {
                return nested;
            }
        }
    }
    return undefined;
}

/**
 * Extract parameters text from a function_definition node.
 */
function extractParams(node: SgNode): string {
    const declarator = findFunctionDeclarator(node);
    if (!declarator) {
        return '()';
    }
    const paramList = declarator.children().find((c) => c.kind() === 'parameter_list');
    return paramList?.text() || '()';
}

/**
 * Extract return type from a function_definition.
 * In C/C++, the return type is one or more children before the declarator.
 */
function extractReturnType(node: SgNode): string {
    const parts: string[] = [];
    for (const child of node.children()) {
        const k = child.kind();
        if (k === 'function_declarator' || k === 'pointer_declarator' || k === 'compound_statement') {
            break;
        }
        if (
            k === 'primitive_type' ||
            k === 'type_identifier' ||
            k === 'type_qualifier' ||
            k === 'sized_type_specifier'
        ) {
            parts.push(child.text());
        }
    }
    return parts.join(' ');
}

/**
 * Check if a function has the `static` storage class specifier.
 */
function hasStaticSpecifier(node: SgNode): boolean {
    return node.children().some((c) => c.kind() === 'storage_class_specifier' && c.text() === 'static');
}

/**
 * Check if a function/declaration has the `extern` storage class specifier.
 */
function hasExternSpecifier(node: SgNode): boolean {
    return node.children().some((c) => c.kind() === 'storage_class_specifier' && c.text() === 'extern');
}

/**
 * Determine the access specifier context of a node inside a class body.
 * Walks backward through siblings in field_declaration_list to find
 * the nearest access_specifier (public/private/protected).
 * Returns 'public' by default for struct members (C++ default for struct is public).
 */
function getAccessSpecifier(node: SgNode, isStruct: boolean): string {
    // Walk previous siblings of the node
    for (const sib of node.prevAll()) {
        if (sib.kind() === 'access_specifier') {
            return sib.text().replace(':', '').trim();
        }
    }
    // Default: struct = public, class = private
    return isStruct ? 'public' : 'private';
}

/**
 * Determine the enclosing class name for a C++ method.
 */
function findEnclosingClassName(node: SgNode): string {
    for (const ancestor of node.ancestors()) {
        const k = ancestor.kind();
        if (k === 'class_specifier' || k === 'struct_specifier') {
            const nameNode = ancestor.children().find((c) => c.kind() === 'type_identifier');
            return nameNode?.text() || '';
        }
    }
    return '';
}

/**
 * Check if the enclosing class/struct is a struct (for default access specifier logic).
 */
function isEnclosingStruct(node: SgNode): boolean {
    for (const ancestor of node.ancestors()) {
        if (ancestor.kind() === 'struct_specifier') {
            return true;
        }
        if (ancestor.kind() === 'class_specifier') {
            return false;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Include extraction
// ---------------------------------------------------------------------------

interface IncludeInfo {
    path: string;
    isSystem: boolean;
}

function extractInclude(node: SgNode): IncludeInfo | null {
    const sysLib = node.children().find((c) => c.kind() === 'system_lib_string');
    if (sysLib) {
        // Strip angle brackets: <stdio.h> -> stdio.h
        return { path: sysLib.text().replace(/^<|>$/g, ''), isSystem: true };
    }

    const strLit = node.children().find((c) => c.kind() === 'string_literal');
    if (strLit) {
        const content = strLit.children().find((c) => c.kind() === 'string_content');
        if (content) {
            return { path: content.text(), isSystem: false };
        }
        // Fallback: strip quotes
        return { path: strLit.text().replace(/^["']|["']$/g, ''), isSystem: false };
    }

    return null;
}

// ---------------------------------------------------------------------------
// C extractor (handles both C and C++)
// ---------------------------------------------------------------------------

function createCExtractor(langKey: 'c' | 'cpp'): LanguageExtractors {
    return {
        extract(root: SgNode, fp: string): ExtractionResult {
            const result = emptyResult();
            const isCpp = langKey === 'cpp';
            const isHeader = isHeaderFile(fp);

            // ── C: type_definition (typedef struct { ... } Name;) ───────
            if (!isCpp) {
                for (const node of root.findAll({ rule: { kind: 'type_definition' } })) {
                    // The typedef name is the type_identifier child of type_definition
                    const nameNode = node.children().find((c) => c.kind() === 'type_identifier');
                    if (!nameNode) {
                        continue;
                    }
                    const name = nameNode.text();

                    // Check if it's a typedef struct (class) or just a typedef alias
                    const hasStruct = node.children().some((c) => c.kind() === 'struct_specifier');

                    if (hasStruct) {
                        const range = nodeRange(node);
                        result.classes.push({
                            name,
                            line_start: range.line_start,
                            line_end: range.line_end,
                            extends: '',
                            implements: [],
                            ast_kind: 'type_definition',
                            modifiers: 'typedef',
                            content_hash: computeContentHash(node.text()),
                            is_exported: isHeader || hasExternSpecifier(node),
                            decorators: [],
                        });
                    }
                }
            }

            // ── Structs (standalone, with name) ────────────────────────
            for (const node of root.findAll({ rule: { kind: 'struct_specifier' } })) {
                const nameNode = node.children().find((c) => c.kind() === 'type_identifier');
                if (!nameNode) {
                    continue; // anonymous struct (part of typedef or local)
                }

                // Skip if this struct_specifier is inside a type_definition (C typedef)
                // — already handled above
                if (!isCpp) {
                    const parent = node.parent();
                    if (parent && parent.kind() === 'type_definition') {
                        continue;
                    }
                }

                const name = nameNode.text();
                const range = nodeRange(node);

                // C++ heritage for structs
                let extendsName = '';
                const implementsList: string[] = [];
                if (isCpp) {
                    const baseClause = node.children().find((c) => c.kind() === 'base_class_clause');
                    if (baseClause) {
                        const typeIds = baseClause.children().filter((c) => c.kind() === 'type_identifier');
                        if (typeIds.length > 0) {
                            extendsName = typeIds[0].text();
                        }
                        for (let i = 1; i < typeIds.length; i++) {
                            implementsList.push(typeIds[i].text());
                        }
                    }
                }

                result.classes.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    extends: extendsName,
                    implements: implementsList,
                    ast_kind: 'struct_specifier',
                    modifiers: '',
                    content_hash: computeContentHash(node.text()),
                    is_exported: isHeader,
                    decorators: [],
                });
            }

            // ── C++ classes ─────────────────────────────────────────────
            if (isCpp) {
                for (const node of root.findAll({ rule: { kind: 'class_specifier' } })) {
                    const nameNode = node.children().find((c) => c.kind() === 'type_identifier');
                    if (!nameNode) {
                        continue;
                    }
                    const name = nameNode.text();

                    // Heritage from base_class_clause
                    let extendsName = '';
                    const implementsList: string[] = [];
                    const baseClause = node.children().find((c) => c.kind() === 'base_class_clause');
                    if (baseClause) {
                        const typeIds = baseClause.children().filter((c) => c.kind() === 'type_identifier');
                        if (typeIds.length > 0) {
                            extendsName = typeIds[0].text();
                        }
                        for (let i = 1; i < typeIds.length; i++) {
                            implementsList.push(typeIds[i].text());
                        }
                    }

                    const range = nodeRange(node);
                    result.classes.push({
                        name,
                        line_start: range.line_start,
                        line_end: range.line_end,
                        extends: extendsName,
                        implements: implementsList,
                        ast_kind: 'class_specifier',
                        modifiers: '',
                        content_hash: computeContentHash(node.text()),
                        is_exported: isHeader,
                        decorators: [],
                    });
                }

                // ── C++ template declarations wrapping classes ──────────
                for (const node of root.findAll({ rule: { kind: 'template_declaration' } })) {
                    const classNode =
                        node.children().find((c) => c.kind() === 'class_specifier') ||
                        node.children().find((c) => c.kind() === 'struct_specifier');
                    if (!classNode) {
                        continue; // template function or other, skip here
                    }
                    const nameNode = classNode.children().find((c) => c.kind() === 'type_identifier');
                    if (!nameNode) {
                        continue;
                    }

                    // Don't duplicate — check if we already extracted this class
                    const name = nameNode.text();
                    if (result.classes.some((c) => c.name === name)) {
                        // Update existing class to mark as template
                        const existing = result.classes.find((c) => c.name === name);
                        if (existing) {
                            existing.modifiers = 'template';
                            // Expand range to include the template keyword
                            const range = nodeRange(node);
                            existing.line_start = range.line_start;
                            existing.line_end = range.line_end;
                        }
                        continue;
                    }

                    let extendsName = '';
                    const implementsList: string[] = [];
                    const baseClause = classNode.children().find((c) => c.kind() === 'base_class_clause');
                    if (baseClause) {
                        const typeIds = baseClause.children().filter((c) => c.kind() === 'type_identifier');
                        if (typeIds.length > 0) {
                            extendsName = typeIds[0].text();
                        }
                        for (let i = 1; i < typeIds.length; i++) {
                            implementsList.push(typeIds[i].text());
                        }
                    }

                    const range = nodeRange(node);
                    result.classes.push({
                        name,
                        line_start: range.line_start,
                        line_end: range.line_end,
                        extends: extendsName,
                        implements: implementsList,
                        ast_kind: 'template_declaration',
                        modifiers: 'template',
                        content_hash: computeContentHash(node.text()),
                        is_exported: isHeader,
                        decorators: [],
                    });
                }

                // ── C++ namespace_definition (extracted as class for scoping) ─
                // We skip namespaces as classes — they are scoping constructs, not types.
                // The functions inside them are extracted naturally.
            }

            // ── Enums ───────────────────────────────────────────────────
            for (const node of root.findAll({ rule: { kind: 'enum_specifier' } })) {
                const nameNode = node.children().find((c) => c.kind() === 'type_identifier');
                if (!nameNode) {
                    continue; // anonymous enum
                }
                const name = nameNode.text();
                const range = nodeRange(node);
                result.enums.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    ast_kind: 'enum_specifier',
                    content_hash: computeContentHash(node.text()),
                    is_exported: isHeader,
                });
            }

            // ── Functions ───────────────────────────────────────────────
            for (const node of root.findAll({ rule: { kind: 'function_definition' } })) {
                const name = extractFuncName(node);
                if (!name) {
                    continue;
                }

                const isStatic = hasStaticSpecifier(node);
                const isExtern = hasExternSpecifier(node);

                // C++ method detection: check for enclosing class
                let className = '';
                let kind: 'Function' | 'Method' | 'Constructor' = 'Function';

                if (isCpp) {
                    className = findEnclosingClassName(node);
                    if (className) {
                        // Check if this is a constructor (name matches class name)
                        if (name === className) {
                            kind = 'Constructor';
                        } else {
                            kind = 'Method';
                        }
                    }
                }

                // is_exported logic:
                // - static functions are NOT exported
                // - extern functions are exported
                // - functions in header files are exported
                // - C++ methods with public access are exported (if the class is in a header)
                let exported = false;
                if (isStatic) {
                    exported = false;
                } else if (isExtern) {
                    exported = true;
                } else if (isHeader) {
                    if (isCpp && className) {
                        // C++ method: check access specifier
                        const access = getAccessSpecifier(node, isEnclosingStruct(node));
                        exported = access === 'public';
                    } else {
                        exported = true;
                    }
                } else if (isCpp && className) {
                    const access = getAccessSpecifier(node, isEnclosingStruct(node));
                    exported = access === 'public';
                }

                const range = nodeRange(node);
                result.functions.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    params: extractParams(node),
                    returnType: extractReturnType(node),
                    kind,
                    ast_kind: 'function_definition',
                    className,
                    modifiers: isStatic ? 'static' : '',
                    content_hash: computeContentHash(node.text()),
                    isTest: false,
                    is_exported: exported,
                    is_async: false, // C/C++ have no native async
                    decorators: [], // C/C++ have no decorators
                    throws: [], // C++ exceptions are implicit; not extracted
                    complexity: computeCyclomatic(node, C_BRANCH_KINDS),
                });
            }

            // ── Includes (imports) ──────────────────────────────────────
            for (const node of root.findAll({ rule: { kind: 'preproc_include' } })) {
                const inc = extractInclude(node);
                if (!inc) {
                    continue;
                }
                // System includes are external — store them but resolver will return null
                result.imports.push({
                    module: inc.path,
                    line: node.range().start.line,
                    names: [],
                    lang: langKey,
                });
            }

            return result;
        },

        extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
            const findEnclosingClass = (node: SgNode): SgNode | null => {
                return (
                    node.ancestors().find((a) => {
                        const k = String(a.kind());
                        return k === 'class_specifier' || k === 'struct_specifier';
                    }) ?? null
                );
            };

            const config: CallExtractionConfig = {
                selfPrefixes: langKey === 'cpp' ? ['this->'] : [],
                superPrefixes: [],
                findEnclosingClass,
                noise: C_NOISE,
            };
            extractCalls(root, fp, config, calls);
        },
    };
}

// Receiver-type inference for C / C++.
//
// Covers `Foo x;` (declaration with no initializer), `Foo y = Foo();`
// (init_declarator) and `Type x = Type(...);`. We intentionally skip
// `auto x = ...;` because the type lives in the RHS expression and
// resolving it reliably requires more than a surface walk.
function extractReceiverTypesC(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const decl of root.findAll({ rule: { kind: 'declaration' } })) {
        const typeNode = decl.field('type');
        const typeName = typeNode?.kind() === 'type_identifier' ? typeNode.text() : undefined;
        if (!typeName) {
            continue;
        }
        for (const c of decl.children()) {
            if (c.kind() === 'identifier') {
                bindings.set(c.text(), typeName);
            } else if (c.kind() === 'init_declarator') {
                const name = c
                    .children()
                    .find((x: SgNode) => x.kind() === 'identifier')
                    ?.text();
                if (name) {
                    bindings.set(name, typeName);
                }
            }
        }
    }
    for (const ce of root.findAll({ rule: { kind: 'call_expression' } })) {
        const fn = ce.field('function');
        if (!fn || fn.kind() !== 'field_expression') {
            continue;
        }
        const base = fn.field('argument') ?? fn.children()[0];
        if (!base || base.kind() !== 'identifier') {
            continue;
        }
        const typeName = bindings.get(base.text());
        if (!typeName) {
            continue;
        }
        const r = ce.range().start;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }
    return out;
}

registerExtractor('c', createCExtractor('c'));
registerExtractor('cpp', createCExtractor('cpp'));
registerReceiverTypes('c', extractReceiverTypesC);
registerReceiverTypes('cpp', extractReceiverTypesC);

// Capabilities:
//   C: no async/await, no decorators/attributes at the language level, no
//      exceptions (errno + return codes), static types, nominal
//      (struct+function-pointer tables, not structural subtyping).
//   C++: same as C but adds try/catch exceptions. Static types, nominal
//      classes/templates.
registerCapabilities('c', {
    hasAsync: false,
    hasDecorators: false,
    hasExceptions: false,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});
registerCapabilities('cpp', {
    hasAsync: false,
    hasDecorators: false,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});
