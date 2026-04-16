/**
 * Elixir AST extractor.
 *
 * Elixir's tree-sitter grammar represents everything as `call` nodes.
 * `defmodule`, `def`, `defp`, `use`, `alias`, `import` are all call nodes
 * distinguished by `field('target')?.text()`. Module attributes like
 * `@behaviour`, `@callback`, `@impl` are `unary_operator` nodes with `@`.
 *
 * Key mappings:
 *  - defmodule → class (or interface if module has @callback attributes)
 *  - def → public function/method (is_exported: true)
 *  - defp → private function/method (is_exported: false)
 *  - @behaviour → implements
 *  - use → heritage extends
 *  - alias/import/use → imports
 *  - @callback → interface method signatures
 */

import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { NOISE } from '../../shared/filters';
import { registerExtractor } from '../engine';
import { computeContentHash, emptyResult, nodeRange } from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/**
 * Check if a call node is a specific macro call (defmodule, def, defp, etc.).
 */
function _isCallTarget(node: SgNode, target: string): boolean {
    return node.kind() === 'call' && node.field('target')?.text() === target;
}

/**
 * Get the module name from a defmodule call node.
 * defmodule call → arguments → first alias child = module name.
 */
function getModuleName(defmoduleNode: SgNode): string | undefined {
    const args = defmoduleNode.children().find((c) => c.kind() === 'arguments');
    const aliasNode = args?.children().find((c) => c.kind() === 'alias');
    return aliasNode?.text();
}

/**
 * Extract function name and params from a def/defp call node.
 *
 * Structure: def call → arguments → first child is a call node (fn signature)
 *   → that call's target is the function name
 *   → that call's arguments are the params
 */
function getFunctionInfo(defNode: SgNode): { name: string; params: string } | undefined {
    const args = defNode.children().find((c) => c.kind() === 'arguments');
    if (!args) {
        return undefined;
    }

    const firstArg = args.children().find((c) => c.isNamed());
    if (!firstArg) {
        return undefined;
    }

    if (firstArg.kind() === 'call') {
        const fnName = firstArg.field('target')?.text();
        if (!fnName) {
            return undefined;
        }

        const fnArgs = firstArg.children().find((c) => c.kind() === 'arguments');
        const params = fnArgs?.text() || '()';
        return { name: fnName, params };
    }

    // Guard-less function with no params: `def name, do: ...`
    if (firstArg.kind() === 'identifier') {
        return { name: firstArg.text(), params: '()' };
    }

    return undefined;
}

/**
 * Get the do_block from a call node (defmodule, def, defp).
 */
function getDoBlock(node: SgNode): SgNode | undefined {
    return node.children().find((c) => c.kind() === 'do_block');
}

/**
 * Find the enclosing defmodule call for a given node.
 */
function findEnclosingModule(node: SgNode): SgNode | null {
    return node.ancestors().find((a) => a.kind() === 'call' && a.field('target')?.text() === 'defmodule') ?? null;
}

/**
 * Collect all @behaviour and @callback attributes from a do_block.
 */
function collectModuleAttributes(doBlock: SgNode): {
    behaviours: string[];
    callbacks: string[];
    uses: string[];
} {
    const behaviours: string[] = [];
    const callbacks: string[] = [];
    const uses: string[] = [];

    for (const child of doBlock.children()) {
        if (child.kind() === 'unary_operator') {
            const operand = child.field('operand');
            if (!operand || operand.kind() !== 'call') {
                continue;
            }

            const attrName = operand.field('target')?.text();
            const attrArgs = operand.children().find((c) => c.kind() === 'arguments');
            const firstArg = attrArgs?.children().find((c) => c.isNamed());
            const value = firstArg?.text() || '';

            if (attrName === 'behaviour' || attrName === 'behavior') {
                behaviours.push(value);
            } else if (attrName === 'callback') {
                // Extract callback name from the binary_operator (name(args) :: type)
                if (firstArg?.kind() === 'binary_operator') {
                    const callNode = firstArg.children().find((c) => c.kind() === 'call');
                    const cbName = callNode?.field('target')?.text();
                    if (cbName) {
                        callbacks.push(cbName);
                    }
                }
            }
        } else if (child.kind() === 'call' && child.field('target')?.text() === 'use') {
            const useArgs = child.children().find((c) => c.kind() === 'arguments');
            const aliasNode = useArgs?.children().find((c) => c.kind() === 'alias');
            if (aliasNode) {
                uses.push(aliasNode.text());
            }
        }
    }

    return { behaviours, callbacks, uses };
}

// ---------------------------------------------------------------------------
// Extractor implementation
// ---------------------------------------------------------------------------

const elixirExtractors: LanguageExtractors = {
    extract(rootNode: SgNode, _fp: string): ExtractionResult {
        const result = emptyResult();
        const allCalls = rootNode.findAll({ rule: { kind: 'call' } });

        // ── Modules (defmodule) ──────────────────────────────────────────
        const defmoduleCalls = allCalls.filter((n) => n.field('target')?.text() === 'defmodule');

        for (const node of defmoduleCalls) {
            const name = getModuleName(node);
            if (!name) {
                continue;
            }

            const doBlock = getDoBlock(node);
            const attrs = doBlock ? collectModuleAttributes(doBlock) : { behaviours: [], callbacks: [], uses: [] };
            const range = nodeRange(node);

            // If the module defines @callback attributes, it's an interface (behaviour)
            if (attrs.callbacks.length > 0) {
                result.interfaces.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    methods: attrs.callbacks,
                    ast_kind: 'call',
                    content_hash: computeContentHash(node.text()),
                    is_exported: true,
                });
            }

            // All modules are treated as classes
            // `use GenServer` is treated as extends (the first `use`).
            // `@behaviour X` is treated as implements.
            const extendsName = attrs.uses.length > 0 ? attrs.uses[0] : '';

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsName,
                implements: attrs.behaviours,
                modifiers: '',
                ast_kind: 'call',
                content_hash: computeContentHash(node.text()),
                is_exported: true, // Elixir modules are always public
                decorators: [],
            });
        }

        // ── Functions (def / defp) ───────────────────────────────────────
        const defCalls = allCalls.filter((n) => {
            const target = n.field('target')?.text();
            return target === 'def' || target === 'defp';
        });

        for (const node of defCalls) {
            const target = node.field('target')!.text();
            const isPublic = target === 'def';
            const fnInfo = getFunctionInfo(node);
            if (!fnInfo) {
                continue;
            }

            const range = nodeRange(node);
            const moduleNode = findEnclosingModule(node);
            const className = moduleNode ? getModuleName(moduleNode) || '' : '';

            // Check for @impl annotation on the preceding sibling
            const prevSiblings = node.prevAll();
            const _hasImpl = prevSiblings.some(
                (sib) => sib.kind() === 'unary_operator' && sib.field('operand')?.field('target')?.text() === 'impl',
            );

            // Test detection: function name starts with "test " or "test_"
            const isTest = /^test[\s_]/.test(fnInfo.name);

            result.functions.push({
                name: fnInfo.name,
                line_start: range.line_start,
                line_end: range.line_end,
                params: fnInfo.params,
                returnType: '', // Elixir has no static return types
                kind: className ? 'Method' : 'Function',
                className,
                modifiers: isPublic ? 'def' : 'defp',
                ast_kind: 'call',
                content_hash: computeContentHash(node.text()),
                isTest,
                is_exported: isPublic,
                is_async: false, // Elixir uses processes, not async/await
                decorators: [], // Elixir module attributes are not decorators
                throws: [], // No throw declarations
            });
        }

        // ── ExUnit test macros ─────────────────────────────────────────
        // ExUnit tests: `test "description" do ... end`
        const testCalls = allCalls.filter((n) => n.field('target')?.text() === 'test');
        for (const node of testCalls) {
            const args = node.children().find((c) => c.kind() === 'arguments');
            const strNode = args?.children().find((c) => c.kind() === 'string');
            if (!strNode) {
                continue;
            }

            // Extract the test description from the string (strip quotes)
            const rawText = strNode.text();
            const testName = `test ${rawText}`;

            const range = nodeRange(node);
            const moduleNode = findEnclosingModule(node);
            const className = moduleNode ? getModuleName(moduleNode) || '' : '';

            result.functions.push({
                name: testName,
                line_start: range.line_start,
                line_end: range.line_end,
                params: '()',
                returnType: '',
                kind: className ? 'Method' : 'Function',
                className,
                modifiers: 'def',
                ast_kind: 'call',
                content_hash: computeContentHash(node.text()),
                isTest: true,
                is_exported: false,
                is_async: false,
                decorators: [],
                throws: [],
            });
        }

        // ── Imports (use / alias / import) ───────────────────────────────
        const importTargets = ['use', 'alias', 'import'];
        const importCalls = allCalls.filter((n) => {
            const target = n.field('target')?.text();
            return target !== undefined && importTargets.includes(target);
        });

        for (const node of importCalls) {
            const _kind = node.field('target')!.text();
            const args = node.children().find((c) => c.kind() === 'arguments');
            const aliasNode = args?.children().find((c) => c.kind() === 'alias');
            const modulePath = aliasNode?.text();
            if (!modulePath) {
                continue;
            }

            // Collect named imports (for `import Ecto.Query, only: [...]`)
            const names: string[] = [];
            const keywordsNode = args?.children().find((c) => c.kind() === 'keywords');
            if (keywordsNode) {
                // Extract function names from `only: [func1: arity, ...]`
                const pairs = keywordsNode.children().filter((c) => c.kind() === 'pair');
                for (const pair of pairs) {
                    const key = pair.children().find((c) => c.kind() === 'keyword');
                    if (key?.text()?.startsWith('only:')) {
                        const list = pair.children().find((c) => c.kind() === 'list');
                        if (list) {
                            for (const item of list.children()) {
                                if (item.kind() === 'keyword') {
                                    const fnName = item.text().replace(/:$/, '');
                                    if (fnName) {
                                        names.push(fnName);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            result.imports.push({
                module: modulePath,
                line: node.range().start.line,
                names,
                lang: 'elixir',
            });
        }

        return result;
    },

    extractCalls(rootNode: SgNode, fp: string, calls: RawCallSite[]): void {
        const seenLines = new Set<string>();
        const allCalls = rootNode.findAll({ rule: { kind: 'call' } });

        for (const node of allCalls) {
            const target = node.field('target');
            if (!target) {
                continue;
            }

            const targetText = target.text();

            // Skip macro calls (defmodule, def, defp, use, alias, import, etc.)
            const macroKeywords = new Set([
                'defmodule',
                'def',
                'defp',
                'defmacro',
                'defmacrop',
                'defstruct',
                'defprotocol',
                'defimpl',
                'defdelegate',
                'defguard',
                'defguardp',
                'defexception',
                'defoverridable',
                'use',
                'alias',
                'import',
                'require',
                'if',
                'unless',
                'case',
                'cond',
                'with',
                'for',
                'raise',
                'throw',
                'try',
                'rescue',
                'catch',
                'after',
                'moduledoc',
                'doc',
                'spec',
                'callback',
                'behaviour',
                'behavior',
                'impl',
                'type',
                'typep',
                'opaque',
            ]);

            if (target.kind() === 'identifier') {
                if (macroKeywords.has(targetText)) {
                    continue;
                }

                // Regular function call
                if (NOISE.has(targetText)) {
                    continue;
                }
                const line = node.range().start.line;
                const key = `${targetText}:${line}`;
                if (seenLines.has(key)) {
                    continue;
                }
                seenLines.add(key);

                calls.push({
                    source: fp,
                    callName: targetText,
                    line,
                });
            } else if (target.kind() === 'dot') {
                // Dot call: Module.function(args) or var.function(args)
                const children = target.children().filter((c) => c.isNamed());
                if (children.length < 2) {
                    continue;
                }

                const methodNode = children[children.length - 1];
                const callName = methodNode.text();

                if (NOISE.has(callName)) {
                    continue;
                }
                const line = node.range().start.line;
                const key = `${callName}:${line}`;
                if (seenLines.has(key)) {
                    continue;
                }
                seenLines.add(key);

                // Check if left side is an alias (module) vs identifier (variable)
                const receiver = children[0];
                let resolveInClass: string | undefined;
                if (receiver.kind() === 'alias') {
                    // Module call: Repo.get(...) → resolve in that module
                    resolveInClass = receiver.text();
                }

                calls.push({
                    source: fp,
                    callName,
                    line,
                    ...(resolveInClass ? { resolveInClass } : {}),
                });
            }
        }
    },
};

registerExtractor('elixir', elixirExtractors);
