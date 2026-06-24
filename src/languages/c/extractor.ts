import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import { computeContentHash, emptyResult, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { C_FIELDS, C_KINDS } from './kinds';

// Branch kinds for C / C++ cyclomatic complexity.
// `case_statement` is the case-level kind (also used for `default:`).
// `if_statement` alone covers `else if` (nested if_statement in `else_clause`);
// including `else_clause` would double-count. `catch_clause` is C++-only
// (C has no exceptions) but harmless to list for both since it just won't
// match in C code.
const C_BRANCH_KINDS = [
    C_KINDS.ifStatement,
    C_KINDS.forStatement,
    C_KINDS.whileStatement,
    C_KINDS.doStatement,
    C_KINDS.caseStatement,
    C_KINDS.conditionalExpression,
    C_KINDS.catchClause,
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
 * For C++: function_declarator > identifier | field_identifier | qualified_identifier
 * Also handles pointer return types where declarator is nested in pointer_declarator.
 *
 * For out-of-class C++ definitions like `UserService::greet() {...}`, the declarator
 * holds a qualified_identifier whose last identifier is the method name.
 */
function extractFuncName(node: SgNode): string | undefined {
    const declarator = findFunctionDeclarator(node);
    if (!declarator) {
        return undefined;
    }

    const direct =
        declarator.children().find((c) => c.kind() === C_KINDS.identifier) ||
        declarator.children().find((c) => c.kind() === C_KINDS.fieldIdentifier);
    if (direct) {
        return direct.text();
    }

    const qualified = declarator.children().find((c) => c.kind() === C_KINDS.qualifiedIdentifier);
    if (qualified) {
        const subs = qualified.children();
        const last = [...subs]
            .reverse()
            .find((c) => c.kind() === C_KINDS.identifier || c.kind() === C_KINDS.fieldIdentifier);
        return last?.text();
    }
    return undefined;
}

/**
 * For out-of-class C++ definitions (`Foo::bar() {...}`), pull the class name
 * from the qualified_identifier's namespace_identifier. Returns '' otherwise.
 */
function extractQualifiedClassName(node: SgNode): string {
    const declarator = findFunctionDeclarator(node);
    if (!declarator) {
        return '';
    }
    const qualified = declarator.children().find((c) => c.kind() === C_KINDS.qualifiedIdentifier);
    if (!qualified) {
        return '';
    }
    const ns = qualified
        .children()
        .find((c) => c.kind() === C_KINDS.namespaceIdentifier || c.kind() === C_KINDS.typeIdentifier);
    return ns?.text() || '';
}

/**
 * Find the function_declarator node, which may be nested inside a pointer_declarator
 * or reference_declarator for functions returning pointers/references.
 */
function findFunctionDeclarator(node: SgNode): SgNode | undefined {
    // Direct child
    const direct = node.children().find((c) => c.kind() === C_KINDS.functionDeclarator);
    if (direct) {
        return direct;
    }

    // Nested inside pointer_declarator or reference_declarator (e.g., `int* foo()`)
    for (const child of node.children()) {
        if (child.kind() === C_KINDS.pointerDeclarator || child.kind() === C_KINDS.referenceDeclarator) {
            const nested = child.children().find((c) => c.kind() === C_KINDS.functionDeclarator);
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
    const paramList = declarator.children().find((c) => c.kind() === C_KINDS.parameterList);
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
        if (k === C_KINDS.functionDeclarator || k === C_KINDS.pointerDeclarator || k === C_KINDS.compoundStatement) {
            break;
        }
        if (
            k === C_KINDS.primitiveType ||
            k === C_KINDS.typeIdentifier ||
            k === C_KINDS.typeQualifier ||
            k === C_KINDS.sizedTypeSpecifier
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
    return node.children().some((c) => c.kind() === C_KINDS.storageClassSpecifier && c.text() === 'static');
}

/**
 * Check if a function/declaration has the `extern` storage class specifier.
 */
function hasExternSpecifier(node: SgNode): boolean {
    return node.children().some((c) => c.kind() === C_KINDS.storageClassSpecifier && c.text() === 'extern');
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
        if (sib.kind() === C_KINDS.accessSpecifier) {
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
        if (k === C_KINDS.classSpecifier || k === C_KINDS.structSpecifier) {
            const nameNode = ancestor.children().find((c) => c.kind() === C_KINDS.typeIdentifier);
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
        if (ancestor.kind() === C_KINDS.structSpecifier) {
            return true;
        }
        if (ancestor.kind() === C_KINDS.classSpecifier) {
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
    const sysLib = node.children().find((c) => c.kind() === C_KINDS.systemLibString);
    if (sysLib) {
        // Strip angle brackets: <stdio.h> -> stdio.h
        return { path: sysLib.text().replace(/^<|>$/g, ''), isSystem: true };
    }

    const strLit = node.children().find((c) => c.kind() === C_KINDS.stringLiteral);
    if (strLit) {
        const content = strLit.children().find((c) => c.kind() === C_KINDS.stringContent);
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
                for (const node of root.findAll({ rule: { kind: C_KINDS.typeDefinition } })) {
                    // The typedef name is the type_identifier child of type_definition
                    const nameNode = node.children().find((c) => c.kind() === C_KINDS.typeIdentifier);
                    if (!nameNode) {
                        continue;
                    }
                    const name = nameNode.text();

                    // Check if it's a typedef struct (class) or just a typedef alias
                    const hasStruct = node.children().some((c) => c.kind() === C_KINDS.structSpecifier);

                    if (hasStruct) {
                        const range = nodeRange(node);
                        result.classes.push({
                            name,
                            line_start: range.line_start,
                            line_end: range.line_end,
                            extends: '',
                            implements: [],
                            ast_kind: C_KINDS.typeDefinition,
                            modifiers: 'typedef',
                            content_hash: computeContentHash(node.text()),
                            is_exported: isHeader || hasExternSpecifier(node),
                            decorators: [],
                        });
                    }
                }
            }

            // ── Structs (standalone, with name) ────────────────────────
            for (const node of root.findAll({ rule: { kind: C_KINDS.structSpecifier } })) {
                const nameNode = node.children().find((c) => c.kind() === C_KINDS.typeIdentifier);
                if (!nameNode) {
                    continue; // anonymous struct (part of typedef or local)
                }

                // Skip if this struct_specifier is inside a type_definition (C typedef)
                // — already handled above
                if (!isCpp) {
                    const parent = node.parent();
                    if (parent && parent.kind() === C_KINDS.typeDefinition) {
                        continue;
                    }
                }

                const name = nameNode.text();
                const range = nodeRange(node);

                // C++ heritage for structs
                let extendsName = '';
                const implementsList: string[] = [];
                if (isCpp) {
                    const baseClause = node.children().find((c) => c.kind() === C_KINDS.baseClassClause);
                    if (baseClause) {
                        const typeIds = baseClause.children().filter((c) => c.kind() === C_KINDS.typeIdentifier);
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
                    ast_kind: C_KINDS.structSpecifier,
                    modifiers: '',
                    content_hash: computeContentHash(node.text()),
                    is_exported: isHeader,
                    decorators: [],
                });
            }

            // ── C++ classes ─────────────────────────────────────────────
            if (isCpp) {
                for (const node of root.findAll({ rule: { kind: C_KINDS.classSpecifier } })) {
                    const nameNode = node.children().find((c) => c.kind() === C_KINDS.typeIdentifier);
                    if (!nameNode) {
                        continue;
                    }
                    const name = nameNode.text();

                    // Heritage from base_class_clause
                    let extendsName = '';
                    const implementsList: string[] = [];
                    const baseClause = node.children().find((c) => c.kind() === C_KINDS.baseClassClause);
                    if (baseClause) {
                        const typeIds = baseClause.children().filter((c) => c.kind() === C_KINDS.typeIdentifier);
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
                        ast_kind: C_KINDS.classSpecifier,
                        modifiers: '',
                        content_hash: computeContentHash(node.text()),
                        is_exported: isHeader,
                        decorators: [],
                    });
                }

                // ── C++ template declarations wrapping classes ──────────
                for (const node of root.findAll({ rule: { kind: C_KINDS.templateDeclaration } })) {
                    const classNode =
                        node.children().find((c) => c.kind() === C_KINDS.classSpecifier) ||
                        node.children().find((c) => c.kind() === C_KINDS.structSpecifier);
                    if (!classNode) {
                        continue; // template function or other, skip here
                    }
                    const nameNode = classNode.children().find((c) => c.kind() === C_KINDS.typeIdentifier);
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
                    const baseClause = classNode.children().find((c) => c.kind() === C_KINDS.baseClassClause);
                    if (baseClause) {
                        const typeIds = baseClause.children().filter((c) => c.kind() === C_KINDS.typeIdentifier);
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
                        ast_kind: C_KINDS.templateDeclaration,
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
            for (const node of root.findAll({ rule: { kind: C_KINDS.enumSpecifier } })) {
                const nameNode = node.children().find((c) => c.kind() === C_KINDS.typeIdentifier);
                if (!nameNode) {
                    continue; // anonymous enum
                }
                const name = nameNode.text();
                const range = nodeRange(node);
                result.enums.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    ast_kind: C_KINDS.enumSpecifier,
                    content_hash: computeContentHash(node.text()),
                    is_exported: isHeader,
                });
            }

            // ── Functions ───────────────────────────────────────────────
            for (const node of root.findAll({ rule: { kind: C_KINDS.functionDefinition } })) {
                const name = extractFuncName(node);
                if (!name) {
                    continue;
                }

                const isStatic = hasStaticSpecifier(node);
                const isExtern = hasExternSpecifier(node);

                // C++ method detection: check for enclosing class
                let className = '';
                let isOutOfClassDef = false;
                let kind: 'Function' | 'Method' | 'Constructor' = 'Function';

                if (isCpp) {
                    className = findEnclosingClassName(node);
                    if (!className) {
                        const qualified = extractQualifiedClassName(node);
                        if (qualified) {
                            className = qualified;
                            isOutOfClassDef = true;
                        }
                    }
                    if (className) {
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
                // - Out-of-class C++ definitions (`Foo::bar() {...}`) — visibility lives
                //   in the header; treat as exported here.
                let exported = false;
                if (isStatic) {
                    exported = false;
                } else if (isExtern) {
                    exported = true;
                } else if (isOutOfClassDef) {
                    exported = true;
                } else if (isHeader) {
                    if (isCpp && className) {
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
                    ast_kind: C_KINDS.functionDefinition,
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
            for (const node of root.findAll({ rule: { kind: C_KINDS.preprocInclude } })) {
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
            // Bespoke walker — the shared `$CALLEE($$$ARGS)` ast-grep pattern
            // produces zero matches against tree-sitter-c (and -cpp), the same
            // gap that prompted custom walkers for PHP and Java. We iterate
            // call_expression nodes directly and dispatch on the function
            // field's kind: identifier (`myFunc()`), field_expression
            // (`x.method()` / `x->method()`), or qualified_identifier
            // (`Foo::bar()` in C++).
            const findEnclosingClass = (node: SgNode): SgNode | null =>
                node.ancestors().find((a) => {
                    const k = String(a.kind());
                    return k === C_KINDS.classSpecifier || k === C_KINDS.structSpecifier;
                }) ?? null;

            for (const ce of root.findAll({ rule: { kind: C_KINDS.callExpression } })) {
                const fn = ce.field(C_FIELDS.function);
                if (!fn) {
                    continue;
                }
                const fnKind = fn.kind();
                let callName: string | undefined;
                let resolveInClass: string | undefined;
                let chainedFromLine: number | undefined;
                let chainedFromColumn: number | undefined;

                if (fnKind === C_KINDS.identifier) {
                    callName = fn.text();
                } else if (fnKind === C_KINDS.fieldExpression) {
                    const fid = fn.children().find((c) => c.kind() === C_KINDS.fieldIdentifier);
                    if (!fid) {
                        continue;
                    }
                    callName = fid.text();
                    if (langKey === 'cpp') {
                        // `this->method()` / `this.method()` resolves in current class.
                        const baseChild = fn.children()[0];
                        if (baseChild?.kind() === C_KINDS.thisExpression || baseChild?.text() === 'this') {
                            const classNode = findEnclosingClass(ce);
                            const nameNode = classNode?.children().find((c) => c.kind() === C_KINDS.typeIdentifier);
                            resolveInClass = nameNode?.text();
                        }
                    }
                    // Chain detection: receiver (first child) is itself a call.
                    const baseChild = fn.children()[0];
                    if (baseChild?.kind() === C_KINDS.callExpression) {
                        const innerFn = baseChild.field(C_FIELDS.function);
                        const innerR = (innerFn ?? baseChild).range().end;
                        chainedFromLine = innerR.line;
                        chainedFromColumn = innerR.column;
                    }
                } else if (fnKind === C_KINDS.qualifiedIdentifier && langKey === 'cpp') {
                    // `Foo::bar()` — qualified static / namespaced call.
                    const subs = fn.children();
                    const ns = subs.find(
                        (c) => c.kind() === C_KINDS.namespaceIdentifier || c.kind() === C_KINDS.typeIdentifier,
                    );
                    const last = [...subs].reverse().find((c) => c.kind() === C_KINDS.identifier);
                    if (!last) {
                        continue;
                    }
                    callName = last.text();
                    if (ns) {
                        resolveInClass = ns.text();
                    }
                } else {
                    continue;
                }

                const r = fn.range().end;
                calls.push({
                    source: fp,
                    callName,
                    line: r.line,
                    column: r.column,
                    ...(resolveInClass ? { resolveInClass } : {}),
                    ...(chainedFromLine !== undefined ? { chainedFromLine, chainedFromColumn } : {}),
                });
            }
        },
    };
}

// Receiver-type inference for C / C++.
//
// Covers `Foo x;` (declaration with no initializer), `Foo y = Foo();`
// (init_declarator) and `Type x = Type(...);`. We intentionally skip
// `auto x = ...;` because the type lives in the RHS expression and
// resolving it reliably requires more than a surface walk.
/**
 * Walk through pointer/reference/array declarators to find the identifier
 * a declaration binds. Handles `Foo x`, `Foo *x`, `Foo &x` (C++),
 * `Foo *x = ...`, and nested combinations like `Foo *const x`.
 * Returns null when no identifier is reachable through the declarator chain.
 */
function findDeclaredName(node: SgNode): string | null {
    if (node.kind() === C_KINDS.identifier) {
        return node.text();
    }
    if (
        node.kind() === C_KINDS.pointerDeclarator ||
        node.kind() === C_KINDS.referenceDeclarator ||
        node.kind() === C_KINDS.initDeclarator ||
        node.kind() === C_KINDS.arrayDeclarator
    ) {
        for (const c of node.children()) {
            const name = findDeclaredName(c);
            if (name) {
                return name;
            }
        }
    }
    return null;
}

function extractReceiverTypesC(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const decl of root.findAll({ rule: { kind: C_KINDS.declaration } })) {
        const typeNode = decl.field(C_FIELDS.type);
        const typeName = typeNode?.kind() === C_KINDS.typeIdentifier ? typeNode.text() : undefined;
        if (!typeName) {
            continue;
        }
        for (const c of decl.children()) {
            const name = findDeclaredName(c);
            if (name) {
                bindings.set(name, typeName);
            }
        }
    }
    for (const ce of root.findAll({ rule: { kind: C_KINDS.callExpression } })) {
        const fn = ce.field(C_FIELDS.function);
        if (!fn || fn.kind() !== C_KINDS.fieldExpression) {
            continue;
        }
        const base = fn.field(C_FIELDS.argument) ?? fn.children()[0];
        if (!base || base.kind() !== C_KINDS.identifier) {
            continue;
        }
        const typeName = bindings.get(base.text());
        if (!typeName) {
            continue;
        }
        const r = fn.range().end;
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
