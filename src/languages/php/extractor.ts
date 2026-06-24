import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import { computeContentHash, emptyResult, extractModifiers, extractThrows, isTestByNaming, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { PHP_FIELDS, PHP_KINDS } from './kinds';

// Branch kinds for PHP cyclomatic complexity.
// PHP grammar emits `else_if_clause` as a named child of `if_statement`
// (NOT as a nested if_statement), so both kinds are needed to count
// `elseif` branches. `case_statement` is the per-case kind (skip outer
// `switch_statement`).
const PHP_BRANCH_KINDS = [
    PHP_KINDS.ifStatement,
    PHP_KINDS.elseIfClause,
    PHP_KINDS.forStatement,
    PHP_KINDS.foreachStatement,
    PHP_KINDS.whileStatement,
    PHP_KINDS.doStatement,
    PHP_KINDS.caseStatement,
    PHP_KINDS.catchClause,
    PHP_KINDS.conditionalExpression,
] as const;

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function phpExtends(node: SgNode): string | undefined {
    const baseClause = node.children().find((c: SgNode) => c.kind() === PHP_KINDS.baseClause);
    if (!baseClause) {
        return undefined;
    }
    // PHP base_clause child is `name` for simple names, `qualified_name` for namespaced ones
    const name = baseClause
        .children()
        .find((c: SgNode) => c.kind() === PHP_KINDS.name || c.kind() === PHP_KINDS.qualifiedName);
    return name?.text();
}

function phpImplements(node: SgNode): string[] {
    const ifaceClause = node.children().find((c: SgNode) => c.kind() === PHP_KINDS.classInterfaceClause);
    if (!ifaceClause) {
        return [];
    }
    return ifaceClause
        .children()
        .filter((c: SgNode) => c.kind() === PHP_KINDS.name || c.kind() === PHP_KINDS.qualifiedName)
        .map((c: SgNode) => c.text());
}

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    // PHP `use` declarations expose the module via a `string`/`string_content`
    // child only for the (rare) string-literal form; the common case is a
    // `name`/`namespace_name` child, falling through to the text-strip below.
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === PHP_KINDS.string) {
            const raw = child.text();
            return raw.replace(/^["'`]|["'`]$/g, '');
        }
        for (const grandchild of child.children()) {
            if (grandchild.kind() === PHP_KINDS.stringContent) {
                return grandchild.text();
            }
        }
    }

    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === PHP_KINDS.name || ck === PHP_KINDS.namespaceName) {
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
        if (child.kind() === PHP_KINDS.name) {
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
        for (const node of root.findAll({ rule: { kind: PHP_KINDS.classDeclaration } })) {
            const name = node.field(PHP_FIELDS.name)?.text();
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
        for (const node of root.findAll({ rule: { kind: PHP_KINDS.interfaceDeclaration } })) {
            const name = node.field(PHP_FIELDS.name)?.text();
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
        const funcKinds = [PHP_KINDS.functionDefinition, PHP_KINDS.methodDeclaration];
        const methodKindSet = new Set<string>([PHP_KINDS.methodDeclaration]);

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field(PHP_FIELDS.name)?.text();
                if (!name) {
                    continue;
                }

                let className = '';
                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                if (classAncestor) {
                    className = classAncestor.field(PHP_FIELDS.name)?.text() || '';
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
                const visibilityMod = node.children().find((c) => String(c.kind()) === PHP_KINDS.visibilityModifier);
                const phpExported = !visibilityMod || visibilityMod.text() === 'public';

                result.functions.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    params: node.field(PHP_FIELDS.parameters)?.text() || '()',
                    returnType: node.field(PHP_FIELDS.returnType)?.text() || '',
                    kind,
                    ast_kind: String(node.kind()),
                    className,
                    modifiers: funcModifiers,
                    content_hash: computeContentHash(node.text()),
                    isTest,
                    is_exported: phpExported,
                    is_async: false,
                    decorators: [],
                    throws: extractThrows(node, [PHP_KINDS.throwExpression]),
                    complexity: computeCyclomatic(node, PHP_BRANCH_KINDS),
                });
            }
        }

        // ── DI: typed properties + PHP 8 promoted constructor properties ──
        // For `private UserRepository $repo;` (PHP 7.4+) or
        // `public function __construct(private UserRepository $repo) {}`
        // (PHP 8.0+ promotion), record `repo → UserRepository` so
        // `$this->repo->method()` routes through the DI tier.
        for (const cls of root.findAll({ rule: { kind: PHP_KINDS.classDeclaration } })) {
            for (const pd of cls.findAll({ rule: { kind: PHP_KINDS.propertyDeclaration } })) {
                const typeNode = pd.children().find((c) => c.kind() === PHP_KINDS.namedType);
                const propEl = pd.children().find((c) => c.kind() === PHP_KINDS.propertyElement);
                if (!typeNode || !propEl) {
                    continue;
                }
                const propName =
                    propEl
                        .children()
                        .find((c) => c.kind() === PHP_KINDS.variableName)
                        ?.text() ?? propEl.text();
                const fieldName = propName.replace(/^\$/, '');
                if (fieldName) {
                    result.diEntries.push({ fieldName, typeName: typeNode.text() });
                }
            }
            // Promoted constructor properties (PHP 8.0+).
            for (const ctor of cls.findAll({ rule: { kind: PHP_KINDS.methodDeclaration } })) {
                if (ctor.field(PHP_FIELDS.name)?.text() !== '__construct') {
                    continue;
                }
                const params = ctor.field(PHP_FIELDS.parameters);
                if (!params) {
                    continue;
                }
                for (const p of params.children()) {
                    if (p.kind() !== PHP_KINDS.simpleParameter && p.kind() !== PHP_KINDS.propertyPromotionParameter) {
                        continue;
                    }
                    const hasVisibility = p.children().some((c) => c.kind() === PHP_KINDS.visibilityModifier);
                    if (!hasVisibility) {
                        continue;
                    }
                    const typeNode = p.children().find((c) => c.kind() === PHP_KINDS.namedType);
                    const varNode = p.children().find((c) => c.kind() === PHP_KINDS.variableName);
                    if (!typeNode || !varNode) {
                        continue;
                    }
                    result.diEntries.push({
                        fieldName: varNode.text().replace(/^\$/, ''),
                        typeName: typeNode.text(),
                    });
                }
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: PHP_KINDS.namespaceUseDeclaration } })) {
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
            return (
                k === PHP_KINDS.classDeclaration ||
                k === PHP_KINDS.interfaceDeclaration ||
                k === PHP_KINDS.traitDeclaration
            );
        }) ?? null;

    // ── function_call_expression: helperFunction() ─────────────────────
    for (const node of root.findAll({ rule: { kind: PHP_KINDS.functionCallExpression } })) {
        const nameNode = node.children().find((c) => c.kind() === PHP_KINDS.name);
        if (!nameNode) {
            continue;
        }
        // Column = end of name (≈ col of `(`). See shared/extract-calls.ts
        // for why end-of-callee is the right convention for chained calls.
        const r = nameNode.range().end;
        calls.push({ source: fp, callName: nameNode.text(), line: r.line, column: r.column });
    }

    // ── member_call_expression: $obj->method(), $this->m(), $this->f->m() ─
    for (const node of root.findAll({ rule: { kind: PHP_KINDS.memberCallExpression } })) {
        // The PHP grammar emits `member_call_expression` children as:
        //   [object, ->, name, arguments]
        // where `object` is `variable_name` (simple) or `member_access_expression`
        // (chained — DI pattern $this->field->method).
        const methodNameNode = node.children().find((c) => c.kind() === PHP_KINDS.name);
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

        if (objectNode.kind() === PHP_KINDS.variableName) {
            // `$this->method()` — resolve in enclosing class
            if (objectNode.text() === '$this') {
                const classNode = findEnclosingClass(node);
                resolveInClass = classNode?.field(PHP_FIELDS.name)?.text();
            }
            // Other $var->method() — no receiver-type inference registered
            // for PHP, so nothing more to add.
        } else if (objectNode.kind() === PHP_KINDS.memberAccessExpression) {
            // `$this->field->method()` — DI pattern.
            // member_access_expression children: [variable_name, ->, name]
            const accessChildren = objectNode.children();
            const base = accessChildren[0];
            const fieldNameNode = accessChildren.find((c) => c.kind() === PHP_KINDS.name);
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
    for (const node of root.findAll({ rule: { kind: PHP_KINDS.scopedCallExpression } })) {
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
            if (c.kind() === PHP_KINDS.doubleColon) {
                seenDoubleColon = true;
                continue;
            }
            if (seenDoubleColon && (c.kind() === PHP_KINDS.name || c.kind() === PHP_KINDS.variableName)) {
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
        if (scopeNode.kind() === PHP_KINDS.relativeScope) {
            const scope = scopeNode.text();
            const classNode = findEnclosingClass(node);
            if (classNode) {
                if (scope === 'parent') {
                    resolveInClass = phpExtends(classNode);
                } else if (scope === 'self' || scope === 'static') {
                    resolveInClass = classNode.field(PHP_FIELDS.name)?.text();
                }
            }
        } else if (scopeNode.kind() === PHP_KINDS.name) {
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

/**
 * Collect scope-local PHP bindings inside a function/method:
 *   $x = new Foo()                         → '$x' → 'Foo'
 *   public function f(Foo $x) {...}        → '$x' → 'Foo' (param type hint)
 * Bindings are tied to a single function — the resolver consults them only
 * for member calls inside that same function body. Reassignments to a
 * differently typed expression aren't tracked (latest write wins, but
 * scope-local guarantees mean cross-method bleed doesn't happen).
 */
function collectPhpBindings(fn: SgNode): Map<string, string> {
    const bindings = new Map<string, string>();
    const params = fn.field(PHP_FIELDS.parameters);
    if (params) {
        for (const p of params.children()) {
            if (p.kind() !== PHP_KINDS.simpleParameter && p.kind() !== PHP_KINDS.propertyPromotionParameter) {
                continue;
            }
            const typeNode = p.children().find((c) => c.kind() === PHP_KINDS.namedType);
            const varNode = p.children().find((c) => c.kind() === PHP_KINDS.variableName);
            if (typeNode && varNode) {
                bindings.set(varNode.text(), typeNode.text());
            }
        }
    }
    for (const a of fn.findAll({ rule: { kind: PHP_KINDS.assignmentExpression } })) {
        const left = a.field(PHP_FIELDS.left);
        const right = a.field(PHP_FIELDS.right);
        if (left?.kind() !== PHP_KINDS.variableName || !right) {
            continue;
        }
        if (right.kind() === PHP_KINDS.objectCreationExpression) {
            const typeNode = right.children().find((c) => {
                const k = c.kind();
                return k === PHP_KINDS.name || k === PHP_KINDS.qualifiedName;
            });
            if (typeNode) {
                bindings.set(left.text(), typeNode.text());
            }
        }
    }
    return bindings;
}

/**
 * Receiver-type inference for PHP. Two paths:
 *   1. `$x->method()` where `$x` was assigned via `$x = new Foo()` or came
 *      from a typed parameter — keyed on the call site location so the
 *      resolver's receiver tier can match `::Foo.method`.
 *   2. `$this->field->method()` is handled by the DI tier (typed properties
 *      / promoted constructor params populate diMaps in `extract`).
 */
function extractReceiverTypesPHP(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const fnKinds = [PHP_KINDS.methodDeclaration, PHP_KINDS.functionDefinition];
    for (const kind of fnKinds) {
        for (const fn of root.findAll({ rule: { kind } })) {
            const bindings = collectPhpBindings(fn);
            if (bindings.size === 0) {
                continue;
            }
            for (const mce of fn.findAll({ rule: { kind: PHP_KINDS.memberCallExpression } })) {
                const obj = mce.children()[0];
                if (!obj || obj.kind() !== PHP_KINDS.variableName || obj.text() === '$this') {
                    continue;
                }
                const typeName = bindings.get(obj.text());
                if (!typeName) {
                    continue;
                }
                const methodNameNode = mce.children().find((c) => c.kind() === PHP_KINDS.name);
                if (!methodNameNode) {
                    continue;
                }
                // Same end-of-callee column convention as extractCallsFromPHP.
                const r = methodNameNode.range().end;
                out.set(locationKey(fp, r.line, r.column), typeName);
            }
        }
    }
    return out;
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
