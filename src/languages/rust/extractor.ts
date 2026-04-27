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
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for Rust cyclomatic complexity.
// `match_arm` is the case-arm kind (skip outer `match_expression`).
// `if_expression` alone covers both `else if` and `if let` (both are nested
// `if_expression` / `let_condition`, not separate kinds). Similarly,
// `while let` is still a `while_expression`. `loop_expression` is infinite
// but included for parity with most tools (break-on-condition adds reachable
// branches).
const RUST_BRANCH_KINDS = [
    'if_expression',
    'match_arm',
    'for_expression',
    'while_expression',
    'loop_expression',
] as const;

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

const ANNOTATION_KIND = 'attribute_item';
const ANNOTATION_NAMES = ['test'];

// ---------------------------------------------------------------------------
// Rust extractor
// ---------------------------------------------------------------------------

export const rustExtractors: LanguageExtractors = {
    extract(root: SgNode, _fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes / Structs (struct_item only, NOT impl_item) ──────────
        for (const node of root.findAll({ rule: { kind: 'struct_item' } })) {
            const name = node.field('name')?.text();
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
                    customCheck: (_n, nd) => nd.children().some((c) => String(c.kind()) === 'visibility_modifier'),
                }),
                decorators: extractDecorators(node, ['attribute_item']),
            });
        }

        // ── Rust: impl Trait for Struct -> implements relationship ───────
        for (const implNode of root.findAll({ rule: { kind: 'impl_item' } })) {
            const traitName = implNode.field('trait')?.text();
            const typeName = implNode.field('type')?.text();
            if (traitName && typeName) {
                const structClass = result.classes.find((c) => c.name === typeName);
                if (structClass && !structClass.implements.includes(traitName)) {
                    structClass.implements.push(traitName);
                }
            }
        }

        // ── Interfaces / Traits ─────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'trait_item' } })) {
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
                is_exported: isExported(name, node, {
                    customCheck: (_n, nd) => nd.children().some((c) => String(c.kind()) === 'visibility_modifier'),
                }),
            });
        }

        // ── Enums ───────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'enum_item' } })) {
            const name = node.field('name')?.text();
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
                    customCheck: (_n, nd) => nd.children().some((c) => String(c.kind()) === 'visibility_modifier'),
                }),
            });
        }

        // ── Functions ───────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'function_item' } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }

            let className = '';

            // Rust: extract className from enclosing impl block
            const implAncestor = node.ancestors().find((a: SgNode) => a.kind() === 'impl_item');
            if (implAncestor) {
                className = implAncestor.field('type')?.text() || '';
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
                params: node.field('parameters')?.text() || '()',
                returnType: node.field('return_type')?.text() || '',
                kind,
                ast_kind: String(node.kind()),
                className,
                modifiers: funcModifiers,
                content_hash: computeContentHash(node.text()),
                isTest,
                is_exported: isExported(name, node, {
                    customCheck: (_n, nd) => nd.children().some((c) => String(c.kind()) === 'visibility_modifier'),
                }),
                is_async: isAsync(node),
                decorators: extractDecorators(node, ['attribute_item']),
                throws: [],
                complexity: computeCyclomatic(node, RUST_BRANCH_KINDS),
            });
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'use_declaration' } })) {
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
            findEnclosingClass: (node) => node.ancestors().find((a) => a.kind() === 'impl_item') ?? null,
        };
        extractCalls(root, fp, config, calls);
    },
};

// Receiver-type inference: `let x = Foo::new()` (scoped_identifier call),
// `let x: Foo = ...` (explicit type annotation).
function extractReceiverTypesRust(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const ld of root.findAll({ rule: { kind: 'let_declaration' } })) {
        const kids = ld.children();
        const nameNode = kids.find((c: SgNode) => c.kind() === 'identifier');
        const name = nameNode?.text();
        if (!name) {
            continue;
        }
        // Explicit type annotation — `type_identifier` appears as a child after `:`.
        const explicitType = kids.find((c: SgNode) => c.kind() === 'type_identifier');
        let typeName: string | undefined = explicitType?.text();
        if (!typeName) {
            // `let x = Foo::new()` → call_expression with scoped_identifier function.
            const call = kids.find((c: SgNode) => c.kind() === 'call_expression');
            const fn = call?.field('function');
            if (fn?.kind() === 'scoped_identifier') {
                // Take the segment before `::` as type.
                const path = fn
                    .children()
                    .find((c: SgNode) => c.kind() === 'identifier' || c.kind() === 'type_identifier');
                if (path) {
                    typeName = path.text();
                }
            }
        }
        if (typeName) {
            bindings.set(name, typeName);
        }
    }
    for (const ce of root.findAll({ rule: { kind: 'call_expression' } })) {
        const fn = ce.field('function');
        if (!fn || fn.kind() !== 'field_expression') {
            continue;
        }
        const base = fn.field('value') ?? fn.children()[0];
        if (!base || base.kind() !== 'identifier') {
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
