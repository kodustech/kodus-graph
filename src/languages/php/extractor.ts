import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor, registerReceiverTypes } from '../engine';
import type { ReceiverTypeMap } from '../receiver-types';
import { computeContentHash, emptyResult, extractModifiers, extractThrows, isTestByNaming, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for PHP cyclomatic complexity.
// PHP grammar emits `else_if_clause` as a named child of `if_statement`
// (NOT as a nested if_statement), so both kinds are needed to count
// `elseif` branches. `case_statement` is the per-case kind (skip outer
// `switch_statement`).
const PHP_BRANCH_KINDS = [
    'if_statement',
    'else_if_clause',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'case_statement',
    'catch_clause',
    'conditional_expression',
] as const;

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function phpExtends(node: SgNode): string | undefined {
    const baseClause = node.children().find((c: SgNode) => c.kind() === 'base_clause');
    if (!baseClause) {
        return undefined;
    }
    // PHP base_clause child is `name` for simple names, `qualified_name` for namespaced ones
    const name = baseClause.children().find((c: SgNode) => c.kind() === 'name' || c.kind() === 'qualified_name');
    return name?.text();
}

function phpImplements(node: SgNode): string[] {
    const ifaceClause = node.children().find((c: SgNode) => c.kind() === 'class_interface_clause');
    if (!ifaceClause) {
        return [];
    }
    return ifaceClause
        .children()
        .filter((c: SgNode) => c.kind() === 'name' || c.kind() === 'qualified_name')
        .map((c: SgNode) => c.text());
}

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'string' || ck === 'interpreted_string_literal' || ck === 'string_fragment') {
            const raw = child.text();
            return raw.replace(/^["'`]|["'`]$/g, '');
        }
        for (const grandchild of child.children()) {
            const gck = grandchild.kind();
            if (gck === 'string_fragment' || gck === 'string_content') {
                return grandchild.text();
            }
        }
    }

    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'scoped_identifier' || ck === 'scoped_type_identifier' || ck === 'qualified_name') {
            return child.text();
        }
    }

    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'name' || ck === 'namespace_name' || ck === 'use_tree') {
            return child.text();
        }
    }

    for (const child of node.children()) {
        if (child.kind() === 'identifier' || child.kind() === 'type_identifier') {
            return child.text();
        }
    }

    return node
        .text()
        .replace(/^\s*(import|use|using|require)\s+/i, '')
        .replace(/[;{}]/g, '')
        .trim();
}

function extractImportNames(node: SgNode): string[] {
    const names: string[] = [];
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'identifier' || ck === 'type_identifier' || ck === 'name') {
            names.push(child.text());
        }
    }
    return names;
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const FUNC_PATTERNS = [/^test/];
const FILE_PATTERNS = [/Test\.php$/];

// ---------------------------------------------------------------------------
// PHP extractor
// ---------------------------------------------------------------------------

export const phpExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes ──────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            const extendsVal = phpExtends(node) || '';

            let implementsVal: string[] = [];
            const rawImpl = phpImplements(node);
            if (Array.isArray(rawImpl)) {
                implementsVal = rawImpl;
            }

            const classModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsVal,
                implements: implementsVal,
                ast_kind: String(node.kind()),
                modifiers: classModifiers,
                content_hash: computeContentHash(node.text()),
                is_exported: true, // PHP classes are public by default
                decorators: [],
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'interface_declaration' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.interfaces.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                methods: [],
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: true, // PHP interfaces are public by default
            });
        }

        // ── Functions / Methods ─────────────────────────────────────────
        const funcKinds = ['function_definition', 'method_declaration'];
        const methodKindSet = new Set(['method_declaration']);

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) {
                    continue;
                }

                let className = '';
                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                if (classAncestor) {
                    className = classAncestor.field('name')?.text() || '';
                }

                let kind: 'Function' | 'Method' | 'Constructor';
                if (methodKindSet.has(funcKind) || className) {
                    kind = 'Method';
                } else {
                    kind = 'Function';
                }

                // Test detection
                const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, 'or');

                const funcModifiers = extractModifiers(node);
                const range = nodeRange(node);

                // PHP: public by default unless private/protected visibility_modifier
                const visibilityMod = node.children().find((c) => String(c.kind()) === 'visibility_modifier');
                const phpExported = !visibilityMod || visibilityMod.text() === 'public';

                result.functions.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    params: node.field('parameters')?.text() || '()',
                    returnType: node.field('return_type')?.text() || '',
                    kind,
                    ast_kind: String(node.kind()),
                    className,
                    modifiers: funcModifiers,
                    content_hash: computeContentHash(node.text()),
                    isTest,
                    is_exported: phpExported,
                    is_async: false,
                    decorators: [],
                    throws: extractThrows(node, ['throw_expression']),
                    complexity: computeCyclomatic(node, PHP_BRANCH_KINDS),
                });
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'namespace_use_declaration' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'php',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        extractCallsFromPHP(root, fp, calls);
    },
};

// PHP grammar does not expose a single wrapper kind that the shared
// `$CALLEE($$$ARGS)` pattern can match against — that pattern yields zero
// hits on real code (validated on laravel/framework: 10 edges for 28k
// functions pre-fix). PHP emits three distinct call kinds plus a
// constructor kind:
//   function_call_expression:  helperFunction()
//   member_call_expression:    $obj->method()      / $this->method()
//                              / $this->field->method()  (DI)
//   scoped_call_expression:    Foo::bar()  / parent::log()  / self::x()
//   object_creation_expression: new Foo()           (tracked elsewhere)
// We walk each kind directly and populate diField / resolveInClass
// matching the TypeScript/Python conventions.
export function extractCallsFromPHP(root: SgNode, fp: string, calls: RawCallSite[]): void {
    const findEnclosingClass = (node: SgNode): SgNode | null =>
        node.ancestors().find((a) => {
            const k = String(a.kind());
            return k === 'class_declaration' || k === 'interface_declaration' || k === 'trait_declaration';
        }) ?? null;

    // ── function_call_expression: helperFunction() ─────────────────────
    for (const node of root.findAll({ rule: { kind: 'function_call_expression' } })) {
        const nameNode = node.children().find((c) => c.kind() === 'name');
        if (!nameNode) {
            continue;
        }
        // Column = end of name (≈ col of `(`). See shared/extract-calls.ts
        // for why end-of-callee is the right convention for chained calls.
        const r = nameNode.range().end;
        calls.push({ source: fp, callName: nameNode.text(), line: r.line, column: r.column });
    }

    // ── member_call_expression: $obj->method(), $this->m(), $this->f->m() ─
    for (const node of root.findAll({ rule: { kind: 'member_call_expression' } })) {
        // The PHP grammar emits `member_call_expression` children as:
        //   [object, ->, name, arguments]
        // where `object` is `variable_name` (simple) or `member_access_expression`
        // (chained — DI pattern $this->field->method).
        const methodNameNode = node.children().find((c) => c.kind() === 'name');
        if (!methodNameNode) {
            continue;
        }
        const callName = methodNameNode.text();

        const objectNode = node.children()[0];
        if (!objectNode) {
            continue;
        }

        let resolveInClass: string | undefined;
        let diField: string | undefined;

        if (objectNode.kind() === 'variable_name') {
            // `$this->method()` — resolve in enclosing class
            if (objectNode.text() === '$this') {
                const classNode = findEnclosingClass(node);
                resolveInClass = classNode?.field('name')?.text();
            }
            // Other $var->method() — no receiver-type inference registered
            // for PHP, so nothing more to add.
        } else if (objectNode.kind() === 'member_access_expression') {
            // `$this->field->method()` — DI pattern.
            // member_access_expression children: [variable_name, ->, name]
            const accessChildren = objectNode.children();
            const base = accessChildren[0];
            const fieldNameNode = accessChildren.find((c) => c.kind() === 'name');
            if (base?.text() === '$this' && fieldNameNode) {
                diField = fieldNameNode.text();
            }
        }

        const r = methodNameNode.range().end;
        calls.push({
            source: fp,
            callName,
            line: r.line,
            column: r.column,
            ...(resolveInClass ? { resolveInClass } : {}),
            ...(diField ? { diField } : {}),
        });
    }

    // ── scoped_call_expression: Foo::bar(), parent::log(), self::x() ────
    for (const node of root.findAll({ rule: { kind: 'scoped_call_expression' } })) {
        // Children: [scope, ::, method-name-or-variable, arguments]
        // scope is either `name` (class like `Foo`) or `relative_scope`
        // (`self`/`parent`/`static`). Method is `name` or `variable_name`.
        const children = node.children();
        const scopeNode = children[0];
        if (!scopeNode) {
            continue;
        }

        // Method-name node is the first `name` or `variable_name` after the `::`.
        // Skip the scope `name` if it's the class side of `Foo::bar()`.
        let methodNode: SgNode | undefined;
        let seenDoubleColon = false;
        for (const c of children) {
            if (c.kind() === '::') {
                seenDoubleColon = true;
                continue;
            }
            if (seenDoubleColon && (c.kind() === 'name' || c.kind() === 'variable_name')) {
                methodNode = c;
                break;
            }
        }
        if (!methodNode) {
            continue;
        }
        // Strip a leading `$` from variable-name callees (`self::$helper()`).
        const callName = methodNode.text().replace(/^\$/, '');
        if (!callName) {
            continue;
        }

        let resolveInClass: string | undefined;
        if (scopeNode.kind() === 'relative_scope') {
            const scope = scopeNode.text();
            const classNode = findEnclosingClass(node);
            if (classNode) {
                if (scope === 'parent') {
                    resolveInClass = phpExtends(classNode);
                } else if (scope === 'self' || scope === 'static') {
                    resolveInClass = classNode.field('name')?.text();
                }
            }
        } else if (scopeNode.kind() === 'name') {
            // `Foo::bar()` — scope is an explicit class name; resolver can
            // use it as a hint to prefer methods in that class.
            resolveInClass = scopeNode.text();
        }

        const r = methodNode.range().end;
        calls.push({
            source: fp,
            callName,
            line: r.line,
            column: r.column,
            ...(resolveInClass ? { resolveInClass } : {}),
        });
    }
}

// Receiver-type inference: no-op.
//
// PHP variables don't require type declarations and are frequently
// reassigned. While explicit parameter/property types and `/** @var */`
// PHPDoc hints exist, tracking them reliably in scope requires parsing
// PHPDoc and cross-referencing assignments — more than a surface walk
// can justify. Registering an empty map so the cascade falls back to
// name-based resolution with no regression.
function extractReceiverTypesPHP(_root: SgNode, _fp: string): ReceiverTypeMap {
    return new Map();
}

registerExtractor('php', phpExtractors);
registerReceiverTypes('php', extractReceiverTypesPHP);

// Capabilities: no async/await in core PHP (Fibers exist but are not
// async/await; concurrency libs like Amp/ReactPHP are opt-in). Attributes
// since 8.0 are decorators. try/catch exceptions. Dynamic types (gradual
// typing exists but not strictly enforced). Nominal interfaces.
registerCapabilities('php', {
    hasAsync: false,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: false,
    interfaceKind: 'nominal',
});

// DI heuristic: Symfony/Laravel projects mirror the Java/Spring convention.
function phpDiHeuristics(typeName: string): string[] {
    return [`${typeName}Impl`, `Default${typeName}`];
}

registerDIHeuristics('php', phpDiHeuristics);
