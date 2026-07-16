import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { log } from '../../shared/logger';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerExtractor, registerReceiverTypes } from '../engine';
import type { ReceiverTypeMap } from '../receiver-types';
import { computeContentHash } from '../shared';
import type { ExtractedFunction, ExtractedImport, ExtractionResult, LanguageExtractors } from '../spec';
import { BASH_FIELDS, BASH_KINDS } from './kinds';

/**
 * Bash cyclomatic branch kinds. Each `elif`/`case` arm and each loop adds a
 * decision point; the outer `if`/`case` container is counted once via its
 * `if_statement`/first arm. `c_style_for_statement` (`for ((i=0;...))`) is
 * listed for completeness — harmless when the file has none.
 */
const BASH_BRANCH_KINDS = [
    BASH_KINDS.ifStatement,
    BASH_KINDS.elifClause,
    BASH_KINDS.whileStatement,
    BASH_KINDS.forStatement,
    BASH_KINDS.cStyleForStatement,
    BASH_KINDS.caseItem,
] as const;

/** Command names that source another file rather than call a function. */
const SOURCE_COMMANDS = new Set(['source', '.']);

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

function extractBashDirect(rootNode: SgNode, fp: string): ExtractionResult {
    const seen = new Set<string>();

    const functions: ExtractedFunction[] = [];
    const imports: ExtractedImport[] = [];

    // ── Functions (both `f() {}` and `function f {}` share one kind) ──
    for (const node of rootNode.findAll({ rule: { kind: BASH_KINDS.functionDefinition } })) {
        const name = node.field(BASH_FIELDS.name)?.text();
        if (!name) {
            continue;
        }
        const line = node.range().start.line;
        const key = `f:${fp}:${name}:${line}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        functions.push({
            name,
            line_start: line,
            line_end: node.range().end.line,
            // Shell functions take positional args ($1, $2) with no formal list.
            params: '()',
            returnType: '',
            kind: 'Function',
            className: '',
            modifiers: '',
            ast_kind: String(node.kind()),
            content_hash: computeContentHash(node.text()),
            isTest: false,
            // Every function in a sourced file is callable — no visibility concept.
            is_exported: true,
            is_async: false,
            decorators: [],
            throws: [],
            complexity: computeCyclomatic(node, BASH_BRANCH_KINDS),
        });
    }

    // ── Imports (`source path` / `. path`) ──
    for (const node of rootNode.findAll({ rule: { kind: BASH_KINDS.command } })) {
        const cmdName = node.field(BASH_FIELDS.name)?.text();
        if (!cmdName || !SOURCE_COMMANDS.has(cmdName)) {
            continue;
        }
        // First argument after the command name is the sourced path. Children of
        // a command are [command_name, ...args]; the first non-name word/string.
        const args = node.children().filter((c) => c.kind() !== BASH_KINDS.commandName);
        const target = args[0]?.text();
        if (!target) {
            continue;
        }
        imports.push({
            // Strip surrounding quotes if the path was a string literal.
            module: target.replace(/^['"]|['"]$/g, ''),
            line: node.range().start.line,
            names: [],
            lang: 'bash',
        });
    }

    return {
        classes: [],
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

/**
 * Bash calls are bare `command` nodes — no parentheses, so the shared
 * `$CALLEE($$$ARGS)` pattern matches nothing here. We emit every command by its
 * name; builtins/coreutils are suppressed later by the noise registry, and the
 * resolver keeps only names that resolve to an in-repo function definition.
 * `source`/`.` are skipped (they become IMPORTS, not calls).
 */
function extractCallsBash(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
    const seenLines = new Set<string>();

    for (const node of rootNode.findAll({ rule: { kind: BASH_KINDS.command } })) {
        const callName = node.field(BASH_FIELDS.name)?.text();
        if (!callName || SOURCE_COMMANDS.has(callName)) {
            continue;
        }
        const line = node.range().start.line;
        const key = `${callName}:${line}`;
        if (seenLines.has(key)) {
            continue;
        }
        seenLines.add(key);

        calls.push({ source: fp, callName, line });
    }
}

/** Backward-compat export mirroring the other languages' test entry point. */
export function extractCallsFromBash(root: SgRoot, fp: string, calls: RawCallSite[]): void {
    try {
        extractCallsBash(root.root(), fp, calls);
    } catch (err) {
        log.debug('Bash call extraction failed', { file: fp, error: String(err) });
    }
}

// ---------------------------------------------------------------------------
// LanguageExtractors implementation
// ---------------------------------------------------------------------------

const bashExtractors: LanguageExtractors = {
    extract(rootNode: SgNode, fp: string): ExtractionResult {
        return extractBashDirect(rootNode, fp);
    },
    extractCalls(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
        extractCallsBash(rootNode, fp, calls);
    },
};

// Receiver-type inference: no-op. Bash has no objects, methods, or types, so
// there is no receiver to infer — every call is a bare command name.
function extractReceiverTypesBash(_root: SgNode, _fp: string): ReceiverTypeMap {
    return new Map();
}

registerExtractor('bash', bashExtractors);
registerReceiverTypes('bash', extractReceiverTypesBash);

// Capabilities: no async, no decorators, no static types. Errors propagate via
// exit codes / `trap`, not exceptions. There is no interface concept, so the
// duck bucket (the loosest) is the honest classification.
registerCapabilities('bash', {
    hasAsync: false,
    hasDecorators: false,
    hasExceptions: false,
    hasStaticTypes: false,
    interfaceKind: 'duck',
});
