import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import {
    buildScopeIndex,
    locationKey,
    type RangedScope,
    type ReceiverTypeMap,
    resolveReceiverScope,
} from '../receiver-types';
import { computeContentHash, extractDecorators, extractThrows, isExported } from '../shared';
import type {
    ExtractedClass,
    ExtractedFunction,
    ExtractedImport,
    ExtractedReExport,
    ExtractionResult,
    LanguageExtractors,
} from '../spec';
import { PYTHON_FIELDS, PYTHON_KINDS } from './kinds';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const EXPORT_RULES = { customCheck: (n: string) => !n.startsWith('_') } as const;
const DECORATOR_KINDS = [PYTHON_KINDS.decorator] as const;
const THROW_KINDS = [PYTHON_KINDS.raiseStatement] as const;

// Branch kinds for Python cyclomatic complexity.
// Python emits `elif_clause` as a named child of the outer `if_statement`
// (NOT as a nested if_statement), so both are needed to count elif branches.
// `conditional_expression` handles ternaries (x if cond else y).
const PY_BRANCH_KINDS = [
    PYTHON_KINDS.ifStatement,
    PYTHON_KINDS.elifClause,
    PYTHON_KINDS.forStatement,
    PYTHON_KINDS.whileStatement,
    PYTHON_KINDS.exceptClause,
    PYTHON_KINDS.conditionalExpression,
    PYTHON_KINDS.caseClause,
] as const;

// ---------------------------------------------------------------------------
// Core extraction (returns ExtractionResult directly)
// ---------------------------------------------------------------------------

function extractPythonDirect(rootNode: SgNode, fp: string): ExtractionResult {
    const seen = new Set<string>();

    const classes: ExtractedClass[] = [];
    const functions: ExtractedFunction[] = [];
    const imports: ExtractedImport[] = [];

    // ── Classes ──
    for (const node of rootNode.findAll({ rule: { kind: PYTHON_KINDS.classDefinition } })) {
        const name = node.field(PYTHON_FIELDS.name)?.text();
        if (!name || seen.has(`c:${fp}:${name}`)) {
            continue;
        }
        seen.add(`c:${fp}:${name}`);

        const argList =
            node.field(PYTHON_FIELDS.superclasses) ||
            node.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.argumentList);
        const extendsName =
            argList
                ?.children()
                .find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier)
                ?.text() || '';

        classes.push({
            name,
            line_start: node.range().start.line,
            line_end: node.range().end.line,
            extends: extendsName,
            implements: [],
            modifiers: '',
            ast_kind: String(node.kind()),
            content_hash: computeContentHash(node.text()),
            is_exported: isExported(name, node, EXPORT_RULES),
            decorators: extractDecorators(node, [...DECORATOR_KINDS]),
        });
    }

    // ── Functions / Methods ──
    for (const node of rootNode.findAll({ rule: { kind: PYTHON_KINDS.functionDefinition } })) {
        const name = node.field(PYTHON_FIELDS.name)?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`m:${fp}:${name}:${line}`)) {
            continue;
        }
        seen.add(`m:${fp}:${name}:${line}`);

        const classAncestor = node.ancestors().find((a: SgNode) => a.kind() === PYTHON_KINDS.classDefinition);
        const className = classAncestor?.field(PYTHON_FIELDS.name)?.text() || '';
        const retType =
            node
                .field(PYTHON_FIELDS.returnType)
                ?.text()
                ?.replace(/^->\s*/, '') || '';

        const isTest = name.startsWith('test_');

        // Python has no distinct async node kind — the `async` keyword is a
        // leading child of `function_definition`, so detect it there.
        const pyIsAsync = node.children().some((c: SgNode) => c.text() === 'async');

        functions.push({
            name,
            line_start: line,
            line_end: node.range().end.line,
            params: node.field(PYTHON_FIELDS.parameters)?.text() || '()',
            returnType: retType,
            kind: name === '__init__' ? 'Constructor' : className ? 'Method' : 'Function',
            className,
            modifiers: '',
            ast_kind: String(node.kind()),
            content_hash: computeContentHash(node.text()),
            isTest: isTest,
            is_exported: isExported(name, node, EXPORT_RULES),
            is_async: pyIsAsync,
            decorators: extractDecorators(node, [...DECORATOR_KINDS]),
            throws: extractThrows(node, [...THROW_KINDS]),
            complexity: computeCyclomatic(node, PY_BRANCH_KINDS),
        });
    }

    // Re-exports happen in `__init__.py` files when `from .x import y` is
    // used as a barrel pattern. Treat ALL relative imports in __init__.py as
    // re-exports — symbols imported there typically flow through to consumers.
    const isInitFile = fp.endsWith('/__init__.py') || fp === '__init__.py';
    const reExports: ExtractedReExport[] = [];

    // ── Imports (from X import Y) ──
    for (const node of rootNode.findAll({ rule: { kind: PYTHON_KINDS.importFromStatement } })) {
        const modNode = node
            .children()
            .find((c: SgNode) => c.kind() === PYTHON_KINDS.dottedName || c.kind() === PYTHON_KINDS.relativeImport);
        const modulePath = modNode?.text() || '';
        if (!modulePath) {
            continue;
        }

        const names: string[] = [];
        for (const child of node.children()) {
            if (child.kind() === PYTHON_KINDS.dottedName && child !== modNode) {
                names.push(child.text());
            }
            if (child.kind() === PYTHON_KINDS.identifier && child !== modNode) {
                names.push(child.text());
            }
        }
        imports.push({
            module: modulePath,
            line: node.range().start.line,
            names,
            lang: 'python',
        });

        // Same statement also acts as a re-export when it's inside __init__.py
        // and the module path is relative (`.` prefix). Absolute imports in
        // __init__.py are less likely to be re-exports — they could be sibling
        // dependencies. Conservative: relative-only.
        if (isInitFile && modNode?.kind() === PYTHON_KINDS.relativeImport) {
            reExports.push({
                module: modulePath,
                line: node.range().start.line,
            });
        }
    }

    // ── Regular imports (import X) ──
    for (const node of rootNode.findAll({ rule: { kind: PYTHON_KINDS.importStatement } })) {
        const modNode = node.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.dottedName);
        if (modNode) {
            imports.push({
                module: modNode.text(),
                line: node.range().start.line,
                names: [modNode.text()],
                lang: 'python',
            });
        }
    }

    return {
        classes,
        functions,
        imports,
        reExports,
        interfaces: [],
        enums: [],
        diEntries: [],
    };
}

// ---------------------------------------------------------------------------
// Call extraction
// ---------------------------------------------------------------------------

/** Python-specific call extraction config for shared extractCalls(). */
const PYTHON_CALL_CONFIG: CallExtractionConfig = {
    selfPrefixes: ['self.'],
    superPrefixes: ['super().'],
    findEnclosingClass: (node) =>
        node.ancestors().find((a: SgNode) => a.kind() === PYTHON_KINDS.classDefinition) ?? null,
    getParentClass: (classNode) => {
        const argList =
            classNode.field(PYTHON_FIELDS.superclasses) ||
            classNode.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.argumentList);
        return argList
            ?.children()
            .find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier)
            ?.text();
    },
};

function extractCallsPython(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
    extractCalls(rootNode, fp, PYTHON_CALL_CONFIG, calls);
}

// ---------------------------------------------------------------------------
// Backward-compat export used by tests/parser/call-extraction.test.ts
// ---------------------------------------------------------------------------

/**
 * Extract raw call sites from a Python AST.
 * Detects self.X() and super().X() to preserve class resolution context.
 */
export function extractCallsFromPython(root: SgRoot, fp: string, calls: RawCallSite[]): void {
    extractCallsPython(root.root(), fp, calls);
}

// ---------------------------------------------------------------------------
// LanguageExtractors implementation
// ---------------------------------------------------------------------------

const pythonExtractors: LanguageExtractors = {
    extract(rootNode: SgNode, fp: string): ExtractionResult {
        return extractPythonDirect(rootNode, fp);
    },
    extractCalls(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
        extractCallsPython(rootNode, fp, calls);
    },
};

// ---------------------------------------------------------------------------
// Receiver-type inference (scope-local, two-pass)
// ---------------------------------------------------------------------------
//
// Grammar shape (tree-sitter-python via ast-grep):
//   `svc = Foo()`          → assignment { identifier, '=', call { identifier, argument_list } }
//   `x: Foo = Foo()`       → assignment { identifier, ':', type { identifier }, '=', call { ... } }
//   `y: Foo`               → assignment { identifier, ':', type { identifier } } (no '=')
//   `def f(s: Foo)`        → parameters { typed_parameter { identifier, ':', type { identifier } }, ... }
//   `svc.update(1)`        → call { attribute { identifier (receiver), '.', identifier (method) }, argument_list }
//
// Scope is function-local: we walk each function_definition /
// async_function_definition body, collect bindings, then record location
// keys for method calls. File-level bindings are ignored (Python code at
// module top-level is rarely typed and `x = Foo()` at module scope is a
// less trustworthy signal than in a function body).
//
// Rules:
//   1. Typed parameter `p: T`  → bind p: T.
//   2. Typed variable `x: T`   → bind x: T. (overrides any constructor heuristic)
//   3. Uppercase constructor `x = Foo(...)` → bind x: Foo (Foo must start uppercase).
//   4. Only the first binding wins; later reassignment is ignored to avoid
//      false positives from flow-insensitive tracking.

function isLikelyClassName(name: string): boolean {
    if (name.length === 0) {
        return false;
    }
    const first = name[0];
    return first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Extract the type name from a Python `type` node. The `type` node is a
 * wrapper whose first `identifier` child is the simple name; generic /
 * subscript forms like `List[Foo]` are skipped (no confident bind).
 */
/**
 * Extract a usable type name from a Python `type` annotation node:
 *   - `Foo`                   → 'Foo'
 *   - `List[Foo]`, `Set[Foo]` → 'Foo'  (collection wrapper)
 *   - `Optional[Foo]`         → 'Foo'  (None-safety wrapper)
 *   - `Dict[str, Foo]`        → 'Foo'  (last type wins — value type for Dict/Mapping)
 *   - `Annotated[Foo, ...]`   → 'Foo'  (PEP 593 — first type, others are metadata)
 * For unrecognized shapes the bare identifier is returned. Returns
 * undefined when no usable type identifier is reachable.
 */
function typeNameFromTypeNode(typeNode: SgNode): string | undefined {
    // Bare type: type > identifier
    const direct = typeNode.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
    if (direct) {
        return direct.text();
    }
    // Generic: type > generic_type > [identifier(wrapper), type_parameter[type, type, ...]]
    const generic = typeNode.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.genericType);
    if (!generic) {
        return undefined;
    }
    const wrapper = generic
        .children()
        .find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier)
        ?.text();
    const params = generic.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.typeParameter);
    if (!params) {
        return wrapper; // No parameters — return the wrapper itself
    }
    const innerTypes = params.children().filter((c: SgNode) => c.kind() === PYTHON_KINDS.type);
    if (innerTypes.length === 0) {
        return wrapper;
    }
    // Annotated[Foo, ...] keeps the first; everything else picks the last
    // (works for Dict[K,V] → V and falls through to T for List/Set/Optional).
    const pick = wrapper === 'Annotated' ? innerTypes[0] : innerTypes[innerTypes.length - 1];
    return typeNameFromTypeNode(pick);
}

/**
 * Collect var-to-type bindings inside a single function body. The caller
 * passes the function_definition node; we walk its descendants and stop
 * descending into nested functions so each scope gets its own bindings.
 */
function collectPythonBindings(fnNode: SgNode): Map<string, string> {
    const bindings = new Map<string, string>();

    // 1. Typed parameters on the function itself. Two AST shapes both
    // count: `typed_parameter` (no default) and `typed_default_parameter`
    // (`x: T = default`) — the latter covers FastAPI's
    // `svc: Service = Depends(get_service)` pattern.
    const params = fnNode.field(PYTHON_FIELDS.parameters);
    if (params) {
        for (const p of params.children()) {
            const k = p.kind();
            if (k !== PYTHON_KINDS.typedParameter && k !== PYTHON_KINDS.typedDefaultParameter) {
                continue;
            }
            const ident = p.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
            const typeNode = p.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.type);
            if (!ident || !typeNode) {
                continue;
            }
            const name = ident.text();
            const typeName = typeNameFromTypeNode(typeNode);
            if (name && typeName && !bindings.has(name)) {
                bindings.set(name, typeName);
            }
        }
    }

    // 2. Assignments inside the function body.
    //    Walk `assignment` nodes but skip any that live inside a nested
    //    function/class so bindings stay scope-local.
    const body = fnNode.field(PYTHON_FIELDS.body);
    if (!body) {
        return bindings;
    }
    for (const a of body.findAll({ rule: { kind: PYTHON_KINDS.assignment } })) {
        // Skip assignments nested inside another function/class within this body.
        // Note: ast-grep returns fresh SgNode wrappers from `ancestors()`, so we
        // can't use reference equality with `fnNode`. Compare byte ranges instead.
        const fnRange = fnNode.range();
        const nested = a.ancestors().some((anc: SgNode) => {
            const k = anc.kind();
            if (
                k !== PYTHON_KINDS.functionDefinition &&
                k !== PYTHON_KINDS.classDefinition &&
                k !== PYTHON_KINDS.lambda
            ) {
                return false;
            }
            const ar = anc.range();
            // Same function as the scope we're collecting for → not nested.
            if (ar.start.index === fnRange.start.index && ar.end.index === fnRange.end.index) {
                return false;
            }
            return true;
        });
        if (nested) {
            continue;
        }

        const kids = a.children();
        const lhs = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
        if (!lhs) {
            continue;
        }
        const name = lhs.text();
        if (bindings.has(name)) {
            // First-binding-wins: skip reassignment.
            continue;
        }

        const typeNode = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.type);
        if (typeNode) {
            const typeName = typeNameFromTypeNode(typeNode);
            if (typeName) {
                bindings.set(name, typeName);
            }
            continue;
        }

        // No annotation → check for `= Foo(...)` uppercase constructor.
        const rhs = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.call);
        if (!rhs) {
            continue;
        }
        const fnIdent = rhs.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
        if (!fnIdent) {
            continue;
        }
        const ctor = fnIdent.text();
        if (isLikelyClassName(ctor)) {
            bindings.set(name, ctor);
            continue;
        }
        // Lowercase factory call: `x = factory()` — emit a deferred marker
        // (`@CALLEE:factory`). The resolver substitutes the callee's return
        // type at resolve time. Falls through gracefully if `factory` has no
        // recorded return type. Mirrors the TS deferred-callee path.
        bindings.set(name, `@CALLEE:${ctor}`);
    }

    return bindings;
}

/**
 * Collect `self.attr → type` bindings for a single class body. This covers
 * three idiomatic Python DI / attribute-declaration patterns:
 *
 *   1. Class-body annotation `repo: Repo` (bare or with default) — the tree
 *      emits `expression_statement > assignment { identifier, ':', type }`
 *      even though Python parses it as an annotated class-level name.
 *   2. Class-body uppercase-constructor `logger = Logger()` — flow-insensitive
 *      but matches how the function-local pass treats the same shape.
 *   3. `__init__` typed parameter stored on self (`self.cache = cache` where
 *      `cache: Cache`).
 *   4. Inline annotated `self.X: Type = ...` inside `__init__`.
 *
 * Intentionally NOT handled (future work): conditional assignments,
 * reassignments later in methods, walrus-style patterns, annotations inside
 * non-`__init__` methods, TYPE_CHECKING guards. Flow analysis is out of scope.
 */
function collectPythonSelfAttrs(classNode: SgNode): Map<string, string> {
    const selfAttrs = new Map<string, string>();

    const body = classNode.field(PYTHON_FIELDS.body);
    if (!body) {
        return selfAttrs;
    }

    // Pass 1a + 1b: class-body top-level expression_statement > assignment
    for (const stmt of body.children()) {
        if (stmt.kind() !== PYTHON_KINDS.expressionStatement) {
            continue;
        }
        const assign = stmt.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.assignment);
        if (!assign) {
            continue;
        }
        const kids = assign.children();
        const lhs = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
        if (!lhs) {
            continue;
        }
        const name = lhs.text();
        if (selfAttrs.has(name)) {
            continue;
        }

        // Rule 1: typed annotation (`repo: UserRepository` or `name: str = "x"`).
        const typeNode = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.type);
        if (typeNode) {
            const typeName = typeNameFromTypeNode(typeNode);
            if (typeName) {
                selfAttrs.set(name, typeName);
            }
            continue;
        }

        // Rule 2: uppercase-constructor assignment (`logger = Logger()`).
        const rhs = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.call);
        if (!rhs) {
            continue;
        }
        const fnIdent = rhs.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
        if (!fnIdent) {
            continue;
        }
        const ctor = fnIdent.text();
        if (isLikelyClassName(ctor)) {
            selfAttrs.set(name, ctor);
        }
    }

    // Pass 1c + 1d: walk __init__ AND common factory methods (setUp,
    // __post_init__, async setup) to recover DI patterns. Tests put their
    // setup in setUp / asyncSetUp; dataclasses use __post_init__; pytest
    // fixtures often run as classmethod factories. All of them assign
    // `self.field = ...` the same way __init__ does.
    const factoryNames = new Set(['__init__', '__post_init__', 'setUp', 'setup', 'asyncSetUp']);
    const factories = body
        .children()
        .filter(
            (c: SgNode) =>
                c.kind() === PYTHON_KINDS.functionDefinition &&
                factoryNames.has(c.field(PYTHON_FIELDS.name)?.text() ?? ''),
        );
    for (const fn of factories) {
        const paramTypes = new Map<string, string>();
        const fnParams = fn.field(PYTHON_FIELDS.parameters);
        if (fnParams) {
            for (const p of fnParams.children()) {
                const k = p.kind();
                if (k !== PYTHON_KINDS.typedParameter && k !== PYTHON_KINDS.typedDefaultParameter) {
                    continue;
                }
                const ident = p.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
                const typeNode = p.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.type);
                if (!ident || !typeNode) {
                    continue;
                }
                const typeName = typeNameFromTypeNode(typeNode);
                if (typeName) {
                    paramTypes.set(ident.text(), typeName);
                }
            }
        }

        const fnBody = fn.field(PYTHON_FIELDS.body);
        if (!fnBody) {
            continue;
        }
        for (const stmt of fnBody.children()) {
            if (stmt.kind() !== PYTHON_KINDS.expressionStatement) {
                continue;
            }
            const assign = stmt.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.assignment);
            if (!assign) {
                continue;
            }
            const kids = assign.children();
            const attr = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.attribute);
            if (!attr) {
                continue;
            }
            const attrKids = attr.children();
            const recv = attrKids.find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
            const attrName = attrKids.filter((c: SgNode) => c.kind() === PYTHON_KINDS.identifier)[1];
            if (!recv || !attrName || recv.text() !== 'self') {
                continue;
            }
            const name = attrName.text();
            if (selfAttrs.has(name)) {
                continue;
            }

            // `self.X: Type = ...`
            const typeNode = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.type);
            if (typeNode) {
                const typeName = typeNameFromTypeNode(typeNode);
                if (typeName) {
                    selfAttrs.set(name, typeName);
                }
                continue;
            }

            // `self.X = typedParam`
            const rhsIdent = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
            if (rhsIdent) {
                const typeName = paramTypes.get(rhsIdent.text());
                if (typeName) {
                    selfAttrs.set(name, typeName);
                    continue;
                }
            }

            // `self.X = Foo(...)` uppercase-call factory inside a setup method.
            const rhsCall = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.call);
            if (rhsCall) {
                const fnIdent = rhsCall.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
                if (fnIdent && isLikelyClassName(fnIdent.text())) {
                    selfAttrs.set(name, fnIdent.text());
                }
            }
        }
    }

    return selfAttrs;
}

/**
 * Collect module-level bindings: `db = Database()`, `logger = getLogger(...)`,
 * `client: HttpClient = ...`. Django/FastAPI codebases lean heavily on this
 * pattern (singletons defined at import time), so without it bare receivers
 * like `db.query(...)` at function scope fall through to cascade.
 *
 * We walk only direct children of the module root; nested assignments inside
 * functions/classes are already covered by `collectPythonBindings`.
 *
 * Rules mirror the function-local pass: typed annotation wins, then PascalCase
 * constructor, then `@CALLEE:` deferred marker for lowercase factories. First
 * binding wins (no flow-sensitive tracking).
 */
function collectPythonModuleBindings(root: SgNode): Map<string, string> {
    const bindings = new Map<string, string>();
    for (const stmt of root.children()) {
        if (stmt.kind() !== PYTHON_KINDS.expressionStatement) {
            continue;
        }
        const assign = stmt.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.assignment);
        if (!assign) {
            continue;
        }
        const kids = assign.children();
        const lhs = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
        if (!lhs) {
            continue;
        }
        const name = lhs.text();
        if (bindings.has(name)) {
            continue;
        }
        const typeNode = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.type);
        if (typeNode) {
            const typeName = typeNameFromTypeNode(typeNode);
            if (typeName) {
                bindings.set(name, typeName);
            }
            continue;
        }
        const rhs = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.call);
        if (!rhs) {
            continue;
        }
        const fnIdent = rhs.children().find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
        if (!fnIdent) {
            continue;
        }
        const ctor = fnIdent.text();
        if (isLikelyClassName(ctor)) {
            bindings.set(name, ctor);
            continue;
        }
        bindings.set(name, `@CALLEE:${ctor}`);
    }
    return bindings;
}

function extractReceiverTypesPython(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();

    // Collect (function node, bindings) pairs for all function scopes.
    // Python's tree-sitter grammar uses `function_definition` for both sync
    // and async (the `async` keyword is a leading child, not a distinct kind).
    const fnScopeList: RangedScope[] = [];
    for (const fn of root.findAll({ rule: { kind: PYTHON_KINDS.functionDefinition } })) {
        const r = fn.range();
        fnScopeList.push({ start: r.start.index, end: r.end.index, bindings: collectPythonBindings(fn) });
    }
    const fnScopeIndex = buildScopeIndex(fnScopeList);

    // Module-level bindings (consulted last as a fallback for bare receivers
    // that no enclosing function scope explains).
    const moduleBindings = collectPythonModuleBindings(root);

    // Collect per-class self.attr → type maps for `self.X.Y()` resolution.
    const classScopeList: RangedScope[] = [];
    for (const cls of root.findAll({ rule: { kind: PYTHON_KINDS.classDefinition } })) {
        const r = cls.range();
        classScopeList.push({ start: r.start.index, end: r.end.index, bindings: collectPythonSelfAttrs(cls) });
    }
    const classScopeIndex = buildScopeIndex(classScopeList);

    // For each method call (`call` whose function is an `attribute` with an
    // identifier receiver), find the innermost enclosing function scope and
    // record the receiver type — if known.
    for (const ce of root.findAll({ rule: { kind: PYTHON_KINDS.call } })) {
        const kids = ce.children();
        const attr = kids.find((c: SgNode) => c.kind() === PYTHON_KINDS.attribute);
        if (!attr) {
            continue;
        }
        const callRange = ce.range();
        const attrKids = attr.children();
        let typeName: string | undefined;

        // Case A: `self.X.Y()` — outer attribute's receiver is `attribute[self.X]`,
        // so we resolve X against the enclosing class's self-attr map.
        const innerAttr = attrKids.find((c: SgNode) => c.kind() === PYTHON_KINDS.attribute);
        if (innerAttr) {
            const innerKids = innerAttr.children();
            const innerRecv = innerKids.find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
            const innerAttrIds = innerKids.filter((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
            if (innerRecv && innerRecv.text() === 'self' && innerAttrIds.length >= 2) {
                const attrName = innerAttrIds[1]!.text();
                typeName = resolveReceiverScope(classScopeIndex, callRange.start.index, callRange.end.index, attrName);
            }
        }

        // Case B: `x.Y()` — outer attribute's receiver is a simple identifier,
        // resolve via the enclosing function's scope-local bindings.
        if (!typeName) {
            const receiver = attrKids.find((c: SgNode) => c.kind() === PYTHON_KINDS.identifier);
            if (!receiver) {
                continue;
            }
            const receiverName = receiver.text();
            // `self.Y()` is intentionally skipped — the resolver handles it via
            // resolveInClass, not via receiver-type.
            if (receiverName === 'self') {
                continue;
            }
            typeName = resolveReceiverScope(fnScopeIndex, callRange.start.index, callRange.end.index, receiverName);
            // Module-scope fallback: when no enclosing function binds the
            // name, consult module-level assignments (`db = Database()`).
            // This is what unlocks Django/FastAPI receiver-tier resolution.
            if (!typeName && moduleBindings.has(receiverName)) {
                typeName = moduleBindings.get(receiverName);
            }
            // Static / classmethod call heuristic: PascalCase receiver with no
            // binding match — `Logger.warn(...)` → receiverType='Logger'.
            if (!typeName && /^[A-Z][A-Za-z0-9_]*$/.test(receiverName)) {
                typeName = receiverName;
            }
        }

        if (!typeName) {
            continue;
        }
        // Column = end of attribute (≈ col of `(` of args). Matches the call
        // extractor convention so chained calls don't collide.
        const r = attr.range().end;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }

    return out;
}

registerExtractor('python', pythonExtractors);
registerReceiverTypes('python', extractReceiverTypesPython);

// Capabilities: async/await since 3.5, decorators, try/except, duck typing,
// type hints are gradual and not enforced at runtime.
registerCapabilities('python', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: false,
    interfaceKind: 'duck',
});
