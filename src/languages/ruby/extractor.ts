import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { LANG_KINDS } from '../../parser/languages';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { log } from '../../shared/logger';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import type { ReceiverTypeMap } from '../receiver-types';
import { computeContentHash } from '../shared';
import type { ExtractedClass, ExtractedFunction, ExtractedImport, ExtractionResult, LanguageExtractors } from '../spec';
import { RUBY_NOISE } from './noise';

// Branch kinds for Ruby cyclomatic complexity.
// Ruby's grammar reuses bare keywords (`if`, `when`, etc.) as BOTH named
// container-node kinds AND anonymous keyword leaves; the helper filters to
// named nodes to avoid double-counting. `when` (case-arm) is used; outer
// `case` is excluded. `elsif` is a named sibling inside `if`, so both are
// listed. Modifiers (`x if cond`) have their own kind (`if_modifier`).
const RUBY_BRANCH_KINDS = [
    'if',
    'elsif',
    'unless',
    'if_modifier',
    'unless_modifier',
    'while',
    'until',
    'while_modifier',
    'until_modifier',
    'for',
    'when',
    'rescue',
    'conditional',
] as const;

// ---------------------------------------------------------------------------
// Core extraction (returns ExtractionResult directly)
// ---------------------------------------------------------------------------

function extractRubyDirect(rootNode: SgNode, fp: string): ExtractionResult {
    const kinds = LANG_KINDS.ruby;
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

        const superclass = node.field('superclass')?.text() || '';
        classes.push({
            name,
            line_start: node.range().start.line,
            line_end: node.range().end.line,
            extends: superclass,
            implements: [],
            modifiers: '',
            ast_kind: String(node.kind()),
            content_hash: computeContentHash(node.text()),
            is_exported: true, // Ruby classes are public by default
            decorators: [],
        });
    }

    // ── Modules ──
    for (const node of rootNode.findAll({ rule: { kind: kinds.module } })) {
        const name = node.field('name')?.text();
        if (!name || seen.has(`c:${fp}:${name}`)) {
            continue;
        }
        seen.add(`c:${fp}:${name}`);
        classes.push({
            name,
            line_start: node.range().start.line,
            line_end: node.range().end.line,
            extends: '',
            implements: [],
            modifiers: '',
            ast_kind: String(node.kind()),
            content_hash: computeContentHash(node.text()),
            is_exported: true, // Ruby modules are public by default
            decorators: [],
        });
    }

    // ── Methods (regular + singleton) ──
    for (const methodKind of [kinds.method, kinds.singletonMethod]) {
        for (const node of rootNode.findAll({ rule: { kind: methodKind } })) {
            const name = node.field('name')?.text();
            if (!name) {
                continue;
            }
            const line = node.range().start.line;
            if (seen.has(`m:${fp}:${name}:${line}`)) {
                continue;
            }
            seen.add(`m:${fp}:${name}:${line}`);

            const classAncestor = node
                .ancestors()
                .find((a: SgNode) => a.kind() === kinds.class || a.kind() === kinds.module);
            const className = classAncestor?.field('name')?.text() || '';

            functions.push({
                name,
                line_start: line,
                line_end: node.range().end.line,
                params: node.field('parameters')?.text() || '()',
                returnType: '',
                kind: className ? 'Method' : 'Function',
                className,
                modifiers: '',
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                isTest: false,
                is_exported: true, // Ruby methods are public by default
                is_async: false, // Ruby has no native async
                decorators: [], // Ruby has no decorators
                throws: [], // Ruby uses raise but no declaration
                complexity: computeCyclomatic(node, RUBY_BRANCH_KINDS),
            });
        }
    }

    // ── Tests (RSpec: describe/it/context) ──
    for (const p of [
        "describe '$NAME' do $$$BODY end",
        'describe "$NAME" do $$$BODY end',
        "it '$NAME' do $$$BODY end",
        'it "$NAME" do $$$BODY end',
        "context '$NAME' do $$$BODY end",
        'context "$NAME" do $$$BODY end',
    ]) {
        try {
            for (const m of rootNode.findAll(p)) {
                const name = m.getMatch('NAME')?.text();
                if (!name) {
                    continue;
                }
                const key = `t:${fp}:${name}:${m.range().start.line}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                // Emit test blocks as functions with isTest=true so the engine
                // creates graph.tests entries.
                // Skip if an identical function was already extracted at the same location.
                const duplicate = functions.some((f) => f.name === name && f.line_start === m.range().start.line);
                if (!duplicate) {
                    functions.push({
                        name,
                        line_start: m.range().start.line,
                        line_end: m.range().end.line,
                        params: '',
                        returnType: '',
                        kind: 'Function',
                        className: '',
                        modifiers: '',
                        ast_kind: String(m.kind()),
                        content_hash: computeContentHash(m.text()),
                        isTest: true,
                        is_exported: false,
                        is_async: false,
                        decorators: [],
                        throws: [],
                        complexity: computeCyclomatic(m, RUBY_BRANCH_KINDS),
                    });
                }
            }
        } catch (err) {
            log.debug('Ruby pattern mismatch', { file: fp, pattern: p, error: String(err) });
        }
    }

    // ── Imports (require/require_relative) ──
    for (const p of [
        "require '$MODULE'",
        'require "$MODULE"',
        "require_relative '$MODULE'",
        'require_relative "$MODULE"',
    ]) {
        try {
            for (const m of rootNode.findAll(p)) {
                const mod = m.getMatch('MODULE')?.text();
                if (mod) {
                    imports.push({
                        module: mod,
                        line: m.range().start.line,
                        names: [],
                        lang: 'ruby',
                    });
                }
            }
        } catch (err) {
            log.debug('Ruby pattern mismatch', { file: fp, pattern: p, error: String(err) });
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

/** Ruby-specific call extraction config for shared extractCalls(). */
function createRubyCallConfig(): CallExtractionConfig {
    const kinds = LANG_KINDS.ruby;
    return {
        selfPrefixes: ['self.'],
        superPrefixes: ['super'],
        findEnclosingClass: (node) =>
            node.ancestors().find((a: SgNode) => a.kind() === kinds.class || a.kind() === kinds.module) ?? null,
        getParentClass: (classNode) => classNode.field('superclass')?.text(),
        noise: RUBY_NOISE,
    };
}

function extractCallsRuby(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
    const config = createRubyCallConfig();

    // Track lines already captured by the pattern-based extraction to avoid duplicates
    const seenLines = new Set<string>();

    extractCalls(rootNode, fp, config, calls);
    for (const c of calls) {
        seenLines.add(`${c.callName}:${c.line}`);
    }

    // ── call nodes: covers both paren and no-paren calls with arguments ──
    // The pattern $CALLEE($$$ARGS) only matches calls with literal parentheses.
    // This loop catches the remaining call nodes (no-paren style).
    for (const node of rootNode.findAll({ rule: { kind: 'call' } })) {
        const methodNode = node.field('method');
        const callName = methodNode?.text();
        if (!callName || RUBY_NOISE.has(callName)) {
            continue;
        }
        const line = node.range().start.line;
        if (seenLines.has(`${callName}:${line}`)) {
            continue;
        }
        seenLines.add(`${callName}:${line}`);

        let resolveInClass: string | undefined;
        const receiver = node.field('receiver');
        if (receiver?.text() === 'self') {
            const classNode = config.findEnclosingClass(node);
            resolveInClass = classNode?.field('name')?.text();
        }

        calls.push({
            source: fp,
            callName,
            line,
            ...(resolveInClass ? { resolveInClass } : {}),
        });
    }

    // ── bare identifiers in body_statement: no-arg, no-paren calls (e.g., `authenticate_user`) ──
    for (const node of rootNode.findAll({ rule: { kind: 'identifier' } })) {
        const parent = node.parent();
        if (!parent || parent.kind() !== 'body_statement') {
            continue;
        }
        const callName = node.text();
        if (RUBY_NOISE.has(callName)) {
            continue;
        }
        const line = node.range().start.line;
        if (seenLines.has(`${callName}:${line}`)) {
            continue;
        }
        seenLines.add(`${callName}:${line}`);

        calls.push({
            source: fp,
            callName,
            line,
        });
    }
}

// ---------------------------------------------------------------------------
// Backward-compat export used by tests/parser/call-extraction.test.ts
// ---------------------------------------------------------------------------

/**
 * Extract raw call sites from a Ruby AST.
 * Detects self.X() and super() to preserve class resolution context.
 */
export function extractCallsFromRuby(root: SgRoot, fp: string, calls: RawCallSite[]): void {
    extractCallsRuby(root.root(), fp, calls);
}

// ---------------------------------------------------------------------------
// LanguageExtractors implementation
// ---------------------------------------------------------------------------

const rubyExtractors: LanguageExtractors = {
    extract(rootNode: SgNode, fp: string): ExtractionResult {
        return extractRubyDirect(rootNode, fp);
    },
    extractCalls(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
        extractCallsRuby(rootNode, fp, calls);
    },
};

// Receiver-type inference: no-op.
//
// Ruby is duck-typed without type annotations. A `x = Foo.new` binding
// ties `x` to `Foo`, but in practice `x` is commonly reassigned to
// anything, so inferring a single receiver type reliably requires runtime
// data (or a full Ruby-style type inferencer like Sorbet). We register
// an empty map and defer — the resolver falls through to name-based
// cascade with no regression.
function extractReceiverTypesRuby(_root: SgNode, _fp: string): ReceiverTypeMap {
    return new Map();
}

registerExtractor('ruby', rubyExtractors);
registerReceiverTypes('ruby', extractReceiverTypesRuby);

// Capabilities: Ruby has no native async/await (concurrency via threads/fibers/
// gems like async-rb), no first-class decorators (macros like `attr_accessor`
// are method calls, not declaration-level metadata), begin/rescue for
// exceptions, dynamic/duck-typed throughout.
registerCapabilities('ruby', {
    hasAsync: false,
    hasDecorators: false,
    hasExceptions: true,
    hasStaticTypes: false,
    interfaceKind: 'duck',
});
