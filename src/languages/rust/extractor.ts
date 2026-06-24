import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import {
    computeContentHash,
    emptyResult,
    extractDecorators,
    extractModifiers,
    hasTestAnnotation,
    isAsync,
    isExported,
    nodeRange,
    stripImportKeyword,
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { RUST_FIELDS, RUST_KINDS } from './kinds';

// Branch kinds for Rust cyclomatic complexity.
// `match_arm` is the case-arm kind (skip outer `match_expression`).
// `if_expression` alone covers both `else if` and `if let` (both are nested
// `if_expression` / `let_condition`, not separate kinds). Similarly,
// `while let` is still a `while_expression`. `loop_expression` is infinite
// but included for parity with most tools (break-on-condition adds reachable
// branches).
const RUST_BRANCH_KINDS = [
    RUST_KINDS.ifExpression,
    RUST_KINDS.matchArm,
    RUST_KINDS.forExpression,
    RUST_KINDS.whileExpression,
    RUST_KINDS.loopExpression,
] as const;

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === RUST_KINDS.scopedIdentifier || ck === RUST_KINDS.scopedTypeIdentifier) {
            return child.text();
        }
    }

    for (const child of node.children()) {
        if (child.kind() === RUST_KINDS.identifier || child.kind() === RUST_KINDS.typeIdentifier) {
            return child.text();
        }
    }

    return stripImportKeyword(node);
}

function extractImportNames(node: SgNode): string[] {
    const names: string[] = [];
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === RUST_KINDS.identifier || ck === RUST_KINDS.typeIdentifier) {
            names.push(child.text());
        }
    }
    return names;
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const ANNOTATION_KIND = RUST_KINDS.attributeItem;
const ANNOTATION_NAMES = ['test'];

// ---------------------------------------------------------------------------
// Rust extractor
// ---------------------------------------------------------------------------

export const rustExtractors: LanguageExtractors = {
    extract(root: SgNode, _fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes / Structs (struct_item only, NOT impl_item) ──────────
        for (const node of root.findAll({ rule: { kind: RUST_KINDS.structItem } })) {
            const name = node.field(RUST_FIELDS.name)?.text();
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: '',
                implements: [],
                ast_kind: String(node.kind()),
                modifiers: '',
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, {
                    customCheck: (_n, nd) =>
                        nd.children().some((c) => String(c.kind()) === RUST_KINDS.visibilityModifier),
                }),
                decorators: extractDecorators(node, [RUST_KINDS.attributeItem]),
            });
        }

        // ── Rust: impl Trait for Struct -> implements relationship ───────
        for (const implNode of root.findAll({ rule: { kind: RUST_KINDS.implItem } })) {
            const traitName = implNode.field(RUST_FIELDS.trait)?.text();
            const typeName = implNode.field(RUST_FIELDS.type)?.text();
            if (traitName && typeName) {
                const structClass = result.classes.find((c) => c.name === typeName);
                if (structClass && !structClass.implements.includes(traitName)) {
                    structClass.implements.push(traitName);
                }
            }
        }

        // ── Interfaces / Traits ─────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: RUST_KINDS.traitItem } })) {
            const name = node.field(RUST_FIELDS.name)?.text();
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
                is_exported: isExported(name, node, {
                    customCheck: (_n, nd) =>
                        nd.children().some((c) => String(c.kind()) === RUST_KINDS.visibilityModifier),
                }),
            });
        }

        // ── Enums ───────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: RUST_KINDS.enumItem } })) {
            const name = node.field(RUST_FIELDS.name)?.text();
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.enums.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, {
                    customCheck: (_n, nd) =>
                        nd.children().some((c) => String(c.kind()) === RUST_KINDS.visibilityModifier),
                }),
            });
        }

        // ── Functions ───────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: RUST_KINDS.functionItem } })) {
            const name = node.field(RUST_FIELDS.name)?.text();
            if (!name) {
                continue;
            }

            let className = '';

            // Rust: extract className from enclosing impl block
            const implAncestor = node.ancestors().find((a: SgNode) => a.kind() === RUST_KINDS.implItem);
            if (implAncestor) {
                className = implAncestor.field(RUST_FIELDS.type)?.text() || '';
            }

            const kind: 'Function' | 'Method' | 'Constructor' = className ? 'Method' : 'Function';

            // Test detection
            const isTest = hasTestAnnotation(node, ANNOTATION_KIND, ANNOTATION_NAMES);

            const funcModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.functions.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                params: node.field(RUST_FIELDS.parameters)?.text() || '()',
                returnType: node.field(RUST_FIELDS.returnType)?.text() || '',
                kind,
                ast_kind: String(node.kind()),
                className,
                modifiers: funcModifiers,
                content_hash: computeContentHash(node.text()),
                isTest,
                is_exported: isExported(name, node, {
                    customCheck: (_n, nd) =>
                        nd.children().some((c) => String(c.kind()) === RUST_KINDS.visibilityModifier),
                }),
                is_async: isAsync(node),
                decorators: extractDecorators(node, [RUST_KINDS.attributeItem]),
                throws: [],
                complexity: computeCyclomatic(node, RUST_BRANCH_KINDS),
            });
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: RUST_KINDS.useDeclaration } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'rust',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        const config: CallExtractionConfig = {
            selfPrefixes: ['self.'],
            superPrefixes: [],
            findEnclosingClass: (node) => node.ancestors().find((a) => a.kind() === RUST_KINDS.implItem) ?? null,
        };
        extractCalls(root, fp, config, calls);
    },
};

// Receiver-type inference: `let x = Foo::new()` (scoped_identifier call),
// `let x: Foo = ...` (explicit type annotation).
function extractReceiverTypesRust(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const ld of root.findAll({ rule: { kind: RUST_KINDS.letDeclaration } })) {
        const kids = ld.children();
        const nameNode = kids.find((c: SgNode) => c.kind() === RUST_KINDS.identifier);
        const name = nameNode?.text();
        if (!name) {
            continue;
        }
        // Explicit type annotation — `type_identifier` appears as a child after `:`.
        const explicitType = kids.find((c: SgNode) => c.kind() === RUST_KINDS.typeIdentifier);
        let typeName: string | undefined = explicitType?.text();
        if (!typeName) {
            // `let x = Foo::new()` → call_expression with scoped_identifier function.
            const call = kids.find((c: SgNode) => c.kind() === RUST_KINDS.callExpression);
            const fn = call?.field(RUST_FIELDS.function);
            if (fn?.kind() === RUST_KINDS.scopedIdentifier) {
                // Take the segment before `::` as type.
                const path = fn
                    .children()
                    .find((c: SgNode) => c.kind() === RUST_KINDS.identifier || c.kind() === RUST_KINDS.typeIdentifier);
                if (path) {
                    typeName = path.text();
                }
            }
        }
        if (typeName) {
            bindings.set(name, typeName);
        }
    }
    // Function/method parameters with explicit types — `fn handle(repo: &Repo)` —
    // become bindings inside the body. Reference types (`&Foo`, `&mut Foo`)
    // unwrap to their referent so method dispatch works on either form.
    const unwrapRustType = (typeNode: SgNode): string | undefined => {
        const kind = typeNode.kind();
        if (kind === RUST_KINDS.typeIdentifier) {
            return typeNode.text();
        }
        if (kind === RUST_KINDS.referenceType) {
            const inner = typeNode
                .children()
                .find((c: SgNode) => c.kind() === RUST_KINDS.typeIdentifier || c.kind() === RUST_KINDS.genericType);
            if (inner) {
                return unwrapRustType(inner);
            }
        }
        if (kind === RUST_KINDS.genericType) {
            return typeNode
                .children()
                .find((c: SgNode) => c.kind() === RUST_KINDS.typeIdentifier)
                ?.text();
        }
        return undefined;
    };
    for (const fn of root.findAll({ rule: { kind: RUST_KINDS.functionItem } })) {
        const params = fn.field(RUST_FIELDS.parameters);
        if (!params) {
            continue;
        }
        for (const p of params.children()) {
            if (p.kind() !== RUST_KINDS.parameter) {
                continue;
            }
            const pattern =
                p.field(RUST_FIELDS.pattern) ?? p.children().find((c: SgNode) => c.kind() === RUST_KINDS.identifier);
            const typeNode = p.field(RUST_FIELDS.type);
            const name = pattern?.kind() === RUST_KINDS.identifier ? pattern.text() : undefined;
            if (!name || !typeNode) {
                continue;
            }
            const typeName = unwrapRustType(typeNode);
            if (typeName) {
                bindings.set(name, typeName);
            }
        }
    }

    for (const ce of root.findAll({ rule: { kind: RUST_KINDS.callExpression } })) {
        const fn = ce.field(RUST_FIELDS.function);
        if (!fn || fn.kind() !== RUST_KINDS.fieldExpression) {
            continue;
        }
        const base = fn.field(RUST_FIELDS.value) ?? fn.children()[0];
        if (!base || base.kind() !== RUST_KINDS.identifier) {
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

registerExtractor('rust', rustExtractors);
registerReceiverTypes('rust', extractReceiverTypesRust);

// Capabilities: Rust has async/await, attributes (`#[derive(...)]`) which we
// model as decorators, Result<_, E>/? for recoverable errors (NOT exceptions —
// `panic!` exists but is not the idiomatic error channel), static types, and
// nominal traits.
registerCapabilities('rust', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: false,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});
