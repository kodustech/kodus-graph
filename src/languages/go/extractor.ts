import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import { computeContentHash, emptyResult, isExported, isTestByNaming, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for Go cyclomatic complexity.
// Case-level kinds only: `expression_case`, `type_case`, `communication_case`
// — skip outer `expression_switch_statement` / `type_switch_statement` /
// `select_statement` to avoid double-counting. `else if` is a nested
// `if_statement` inside the outer if's alternative, so `if_statement` alone
// covers both. `default_case` is excluded (it isn't a decision — a switch
// always falls through to it and it matches no value).
const GO_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'expression_case',
    'type_case',
    'communication_case',
] as const;

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
// Import extraction helpers (shared logic extracted from generic.ts)
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    // Strategy 1: look for string literal children
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

const FILE_PATTERNS = [/_test\.go$/];
const FUNC_PATTERNS = [/^Test/, /^Benchmark/];
const MATCH_MODE = 'and' as const;

// ---------------------------------------------------------------------------
// Go extractor
// ---------------------------------------------------------------------------

export const goExtractors: LanguageExtractors = {
    extract(root: SgNode, fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes / Structs ────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'type_declaration' } })) {
            const kind = goTypeKind(node);
            if (kind !== 'struct') {
                continue;
            }
            const name = goTypeName(node);
            if (!name) {
                continue;
            }

            // Go struct embedding: field_declaration with type but no name
            let goExtends = '';
            const typeSpec = node.children().find((c) => c.kind() === 'type_spec');
            const structType = typeSpec?.children().find((c) => c.kind() === 'struct_type');
            if (structType) {
                const fieldDeclList = structType.children().find((c) => c.kind() === 'field_declaration_list');
                if (fieldDeclList) {
                    for (const field of fieldDeclList.children()) {
                        if (field.kind() !== 'field_declaration') {
                            continue;
                        }
                        const fieldName = field.field('name');
                        const fieldType = field.field('type');
                        if (!fieldName && fieldType) {
                            const typeId = field.children().find((c) => c.kind() === 'type_identifier');
                            if (typeId) {
                                goExtends = typeId.text();
                                break;
                            }
                        }
                    }
                }
            }

            const range = nodeRange(node);
            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: goExtends,
                implements: [],
                ast_kind: String(node.kind()),
                modifiers: '',
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, { customCheck: (n) => /^[A-Z]/.test(n) }),
                decorators: [],
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'type_declaration' } })) {
            const kind = goTypeKind(node);
            if (kind !== 'interface') {
                continue;
            }
            const name = goTypeName(node);
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
                is_exported: isExported(name, node, { customCheck: (n) => /^[A-Z]/.test(n) }),
            });
        }

        // ── Functions / Methods ─────────────────────────────────────────
        const funcKinds = ['function_declaration', 'method_declaration'];

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) {
                    continue;
                }

                let className = '';

                // Go methods: extract className from receiver parameter
                if (node.kind() === 'method_declaration') {
                    const receiver = node.field('receiver');
                    if (receiver) {
                        for (const child of receiver.children()) {
                            if (child.kind() === 'parameter_declaration') {
                                for (const gc of child.children()) {
                                    if (gc.kind() === 'type_identifier') {
                                        className = gc.text();
                                        break;
                                    }
                                    if (gc.kind() === 'pointer_type') {
                                        for (const pt of gc.children()) {
                                            if (pt.kind() === 'type_identifier') {
                                                className = pt.text();
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (className) {
                                    break;
                                }
                            }
                        }
                    }
                }

                const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

                // Test detection
                const isTest = isTestByNaming(fp, name, FILE_PATTERNS, FUNC_PATTERNS, MATCH_MODE);

                const range = nodeRange(node);
                result.functions.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    params: node.field('parameters')?.text() || '()',
                    // Go tree-sitter exposes the return type as `result` field,
                    // not `return_type`. Without this, the chain pass and
                    // deferred-callee silently couldn't propagate Go return types.
                    returnType: node.field('result')?.text() || '',
                    kind,
                    ast_kind: String(node.kind()),
                    className,
                    modifiers: '',
                    content_hash: computeContentHash(node.text()),
                    isTest,
                    is_exported: isExported(name, node, { customCheck: (n) => /^[A-Z]/.test(n) }),
                    is_async: false,
                    decorators: [],
                    throws: [],
                    complexity: computeCyclomatic(node, GO_BRANCH_KINDS),
                });
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'import_declaration' } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'go',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        const findEnclosingClass = (node: SgNode): SgNode | null => {
            return (
                node.ancestors().find((a) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                }) ?? null
            );
        };

        const config: CallExtractionConfig = {
            selfPrefixes: [],
            superPrefixes: [],
            findEnclosingClass,
        };
        extractCalls(root, fp, config, calls);
    },
};

// Receiver-type inference for Go.
//
// Covers three idioms:
//   1. `var y Bar`                     — explicit type declaration
//   2. `z := Baz{}` / `z := &Baz{...}` — composite literal (direct type name)
//   3. `x := NewFoo()`                 — factory prefix heuristic: strip
//      leading `New` when the call is a bare identifier. We intentionally
//      don't consult the symbol table here (it's built later in the
//      pipeline); the heuristic is conservative but catches the dominant
//      Go factory convention.
function extractReceiverTypesGo(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    // `var y Bar`
    for (const vs of root.findAll({ rule: { kind: 'var_spec' } })) {
        const name = vs.field('name')?.text();
        const type = vs.field('type')?.text();
        if (name && type) {
            bindings.set(name, type);
        }
    }
    // `x := ...`
    for (const svd of root.findAll({ rule: { kind: 'short_var_declaration' } })) {
        const kids = svd.children();
        const lhs = kids.find((c: SgNode) => c.kind() === 'expression_list');
        const rhsIdx = kids.findIndex((c: SgNode) => c.kind() === ':=');
        const rhs =
            rhsIdx >= 0 ? kids.slice(rhsIdx + 1).find((c: SgNode) => c.kind() === 'expression_list') : undefined;
        if (!lhs || !rhs) {
            continue;
        }
        const nameNode = lhs.children().find((c: SgNode) => c.kind() === 'identifier');
        const name = nameNode?.text();
        const rhsExpr = rhs.children()[0];
        if (!name || !rhsExpr) {
            continue;
        }
        let typeName: string | undefined;
        // composite literal: `Foo{...}` has kind `composite_literal` with a type field.
        if (rhsExpr.kind() === 'composite_literal') {
            typeName = rhsExpr.field('type')?.text();
        } else if (rhsExpr.kind() === 'unary_expression') {
            // `&Foo{...}` — child is composite_literal.
            const cl = rhsExpr.children().find((c: SgNode) => c.kind() === 'composite_literal');
            typeName = cl?.field('type')?.text();
        } else if (rhsExpr.kind() === 'call_expression') {
            const fn = rhsExpr.field('function');
            if (fn?.kind() === 'identifier') {
                const t = fn.text();
                // Factory heuristic: `NewFoo` → `Foo` (dominant Go convention).
                if (t.startsWith('New') && t.length > 3 && /^[A-Z]/.test(t[3])) {
                    typeName = t.substring(3);
                }
            }
        }
        if (typeName) {
            bindings.set(name, typeName);
        }
    }
    // Function/method parameters with explicit types — `func handle(req *Request)` —
    // and method receivers — `func (s *Server) Handle()` — become bindings.
    // `*Foo` strips to `Foo` so method dispatch works on both pointer and value
    // receivers.
    const seedGoParam = (p: SgNode): void => {
        if (p.kind() !== 'parameter_declaration') {
            return;
        }
        const name = p
            .children()
            .find((c: SgNode) => c.kind() === 'identifier')
            ?.text();
        const typeNode =
            p.field('type') ??
            p.children().find((c: SgNode) => /_type$/.test(String(c.kind())) || c.kind() === 'type_identifier');
        if (!name || !typeNode) {
            return;
        }
        let typeName: string | undefined;
        if (typeNode.kind() === 'pointer_type') {
            typeName = typeNode
                .children()
                .find((c: SgNode) => c.kind() === 'type_identifier' || c.kind() === 'qualified_type')
                ?.text();
        } else if (typeNode.kind() === 'type_identifier' || typeNode.kind() === 'qualified_type') {
            typeName = typeNode.text();
        }
        if (typeName) {
            bindings.set(name, typeName);
        }
    };
    for (const fn of root.findAll({ rule: { kind: 'function_declaration' } })) {
        const params = fn.field('parameters');
        if (params) {
            for (const p of params.children()) {
                seedGoParam(p);
            }
        }
    }
    for (const md of root.findAll({ rule: { kind: 'method_declaration' } })) {
        const recv = md.field('receiver');
        if (recv) {
            for (const p of recv.children()) {
                seedGoParam(p);
            }
        }
        const params = md.field('parameters');
        if (params) {
            for (const p of params.children()) {
                seedGoParam(p);
            }
        }
    }

    for (const ce of root.findAll({ rule: { kind: 'call_expression' } })) {
        const fn = ce.field('function');
        if (!fn || fn.kind() !== 'selector_expression') {
            continue;
        }
        const operand = fn.field('operand') ?? fn.children()[0];
        if (!operand || operand.kind() !== 'identifier') {
            continue;
        }
        const typeName = bindings.get(operand.text());
        if (!typeName) {
            continue;
        }
        // Column = end of selector_expression (≈ col of `(`). Matches the call
        // extractor convention so chained calls have distinct columns.
        const r = fn.range().end;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }
    return out;
}

registerExtractor('go', goExtractors);
registerReceiverTypes('go', extractReceiverTypesGo);

// Capabilities: Go has no async/await (goroutines + channels drive concurrency),
// no decorators, no try/catch (panic/recover is not idiomatic exception handling),
// static types, and structural interfaces (implicit satisfaction).
registerCapabilities('go', {
    hasAsync: false,
    hasDecorators: false,
    hasExceptions: false,
    hasStaticTypes: true,
    interfaceKind: 'structural',
});

// DI heuristic: Go uses `-er` suffix for single-method interfaces
// (`Reader` → `Read`) and `Default<Type>` for interface implementations
// (`Storage` → `DefaultStorage`). Both forms are common enough that we
// try them in order.
function goDiHeuristics(typeName: string): string[] {
    const out: string[] = [];
    if (typeName.endsWith('er') && typeName.length > 2) {
        out.push(typeName.substring(0, typeName.length - 2));
    }
    out.push(`Default${typeName}`);
    return out;
}

registerDIHeuristics('go', goDiHeuristics);
