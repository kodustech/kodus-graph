import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { LANG_KINDS } from '../../parser/languages';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import { computeContentHash, extractDecorators, extractThrows, isExported } from '../shared';
import type { ExtractedClass, ExtractedFunction, ExtractedImport, ExtractionResult, LanguageExtractors } from '../spec';
import { PYTHON_NOISE } from './noise';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const EXPORT_RULES = { customCheck: (n: string) => !n.startsWith('_') } as const;
const DECORATOR_KINDS = ['decorator'] as const;
const THROW_KINDS = ['raise_statement'] as const;

// Branch kinds for Python cyclomatic complexity.
// Python emits `elif_clause` as a named child of the outer `if_statement`
// (NOT as a nested if_statement), so both are needed to count elif branches.
// `conditional_expression` handles ternaries (x if cond else y).
const PY_BRANCH_KINDS = [
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'except_clause',
    'conditional_expression',
    'case_clause',
] as const;

// ---------------------------------------------------------------------------
// Core extraction (returns ExtractionResult directly)
// ---------------------------------------------------------------------------

function extractPythonDirect(rootNode: SgNode, fp: string): ExtractionResult {
    const kinds = LANG_KINDS.python;
    const seen = new Set<string>();

    const classes: ExtractedClass[] = [];
    const functions: ExtractedFunction[] = [];
    const imports: ExtractedImport[] = [];

    // ── Classes ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.class } })) {
        const name = node.field('name')?.text();
        if (!name || seen.has(`c:${fp}:${name}`)) {
            continue;
        }
        seen.add(`c:${fp}:${name}`);

        const argList = node.field('superclasses') || node.children().find((c: SgNode) => c.kind() === 'argument_list');
        const extendsName =
            argList
                ?.children()
                .find((c: SgNode) => c.kind() === 'identifier')
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
    for (const node of rootNode.findAll({ rule: { kind: kinds.function } })) {
        const name = node.field('name')?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        if (seen.has(`m:${fp}:${name}:${line}`)) {
            continue;
        }
        seen.add(`m:${fp}:${name}:${line}`);

        const classAncestor = node.ancestors().find((a: SgNode) => a.kind() === kinds.class);
        const className = classAncestor?.field('name')?.text() || '';
        const retType =
            node
                .field('return_type')
                ?.text()
                ?.replace(/^->\s*/, '') || '';

        const isTest = name.startsWith('test_');

        // Python async: node kind could be 'function_definition' with 'async' keyword child,
        // or the node itself may have text starting with 'async'
        const pyIsAsync =
            String(node.kind()) === 'async_function_definition' ||
            node.children().some((c: SgNode) => c.text() === 'async') ||
            node.parent()?.kind() === 'async_function_definition';

        functions.push({
            name,
            line_start: line,
            line_end: node.range().end.line,
            params: node.field('parameters')?.text() || '()',
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

    // ── Imports (from X import Y) ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.import } })) {
        const modNode = node
            .children()
            .find((c: SgNode) => c.kind() === 'dotted_name' || c.kind() === 'relative_import');
        const modulePath = modNode?.text() || '';
        if (!modulePath) {
            continue;
        }

        const names: string[] = [];
        for (const child of node.children()) {
            if (child.kind() === 'dotted_name' && child !== modNode) {
                names.push(child.text());
            }
            if (child.kind() === 'identifier' && child !== modNode) {
                names.push(child.text());
            }
        }
        imports.push({
            module: modulePath,
            line: node.range().start.line,
            names,
            lang: 'python',
        });
    }

    // ── Regular imports (import X) ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.importRegular } })) {
        const modNode = node.children().find((c: SgNode) => c.kind() === 'dotted_name');
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
        reExports: [],
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
    findEnclosingClass: (node) => node.ancestors().find((a: SgNode) => a.kind() === 'class_definition') ?? null,
    getParentClass: (classNode) => {
        const argList =
            classNode.field('superclasses') || classNode.children().find((c: SgNode) => c.kind() === 'argument_list');
        return argList
            ?.children()
            .find((c: SgNode) => c.kind() === 'identifier')
            ?.text();
    },
    noise: PYTHON_NOISE,
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
function typeNameFromTypeNode(typeNode: SgNode): string | undefined {
    const first = typeNode.children().find((c: SgNode) => c.kind() === 'identifier');
    return first?.text();
}

/**
 * Collect var-to-type bindings inside a single function body. The caller
 * passes the function_definition node; we walk its descendants and stop
 * descending into nested functions so each scope gets its own bindings.
 */
function collectPythonBindings(fnNode: SgNode): Map<string, string> {
    const bindings = new Map<string, string>();

    // 1. Typed parameters on the function itself.
    const params = fnNode.field('parameters');
    if (params) {
        for (const p of params.findAll({ rule: { kind: 'typed_parameter' } })) {
            const ident = p.children().find((c: SgNode) => c.kind() === 'identifier');
            const typeNode = p.children().find((c: SgNode) => c.kind() === 'type');
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
    const body = fnNode.field('body');
    if (!body) {
        return bindings;
    }
    for (const a of body.findAll({ rule: { kind: 'assignment' } })) {
        // Skip assignments nested inside another function/class within this body.
        // Note: ast-grep returns fresh SgNode wrappers from `ancestors()`, so we
        // can't use reference equality with `fnNode`. Compare byte ranges instead.
        const fnRange = fnNode.range();
        const nested = a.ancestors().some((anc: SgNode) => {
            const k = anc.kind();
            if (k !== 'function_definition' && k !== 'class_definition' && k !== 'lambda') {
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
        const lhs = kids.find((c: SgNode) => c.kind() === 'identifier');
        if (!lhs) {
            continue;
        }
        const name = lhs.text();
        if (bindings.has(name)) {
            // First-binding-wins: skip reassignment.
            continue;
        }

        const typeNode = kids.find((c: SgNode) => c.kind() === 'type');
        if (typeNode) {
            const typeName = typeNameFromTypeNode(typeNode);
            if (typeName) {
                bindings.set(name, typeName);
            }
            continue;
        }

        // No annotation → check for `= Foo(...)` uppercase constructor.
        const rhs = kids.find((c: SgNode) => c.kind() === 'call');
        if (!rhs) {
            continue;
        }
        const fnIdent = rhs.children().find((c: SgNode) => c.kind() === 'identifier');
        if (!fnIdent) {
            continue;
        }
        const ctor = fnIdent.text();
        if (isLikelyClassName(ctor)) {
            bindings.set(name, ctor);
        }
    }

    return bindings;
}

function extractReceiverTypesPython(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();

    // Collect (function node, bindings) pairs for all function scopes.
    // Python's tree-sitter grammar uses `function_definition` for both sync
    // and async (the `async` keyword is a leading child, not a distinct kind).
    const fnScopes: { node: SgNode; bindings: Map<string, string> }[] = [];
    for (const fn of root.findAll({ rule: { kind: 'function_definition' } })) {
        fnScopes.push({ node: fn, bindings: collectPythonBindings(fn) });
    }

    // For each method call (`call` whose function is an `attribute` with an
    // identifier receiver), find the innermost enclosing function scope and
    // record the receiver type — if known.
    for (const ce of root.findAll({ rule: { kind: 'call' } })) {
        const kids = ce.children();
        const attr = kids.find((c: SgNode) => c.kind() === 'attribute');
        if (!attr) {
            continue;
        }
        const attrKids = attr.children();
        const receiver = attrKids.find((c: SgNode) => c.kind() === 'identifier');
        if (!receiver) {
            continue;
        }
        const receiverName = receiver.text();

        const callRange = ce.range();
        let typeName: string | undefined;
        let bestSize = Infinity;
        for (const { node, bindings } of fnScopes) {
            const nr = node.range();
            if (nr.start.index > callRange.start.index || nr.end.index < callRange.end.index) {
                continue;
            }
            const size = nr.end.index - nr.start.index;
            if (size < bestSize && bindings.has(receiverName)) {
                typeName = bindings.get(receiverName);
                bestSize = size;
            }
        }
        if (!typeName) {
            continue;
        }
        const r = callRange.start;
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
