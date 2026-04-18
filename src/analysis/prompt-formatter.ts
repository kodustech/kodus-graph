import type { EnrichedFunction, ImpactCategory } from '../graph/types';
import { getCapabilitiesFor } from '../languages/capabilities';
import { languageOfFile } from '../languages/language-of-file';
import { MAX_ALTERNATIVES_RENDERED } from './constants';
import type { ContextV2Output } from './context-builder';
import { renderParamsDiff, renderReturnTypeDiff } from './contract-diff-render';
import type { ContractDiff } from './diff';

export interface PromptFormatterOptions {
    /** Max functions to include in CHANGED section (default: 30). */
    maxFunctions?: number;
    /** Max total chars for the prompt — truncates BLAST RADIUS, then IMPORTS if exceeded (default: 20000). */
    maxPromptChars?: number;
}

const DEFAULT_MAX_FUNCTIONS = 30;
const DEFAULT_MAX_PROMPT_CHARS = 20_000;

/**
 * Return the subset of contract diffs that are semantically meaningful for the
 * function's language. Fields like `is_async` on Go, `throws` on Rust, or
 * `decorators` on C are filtered out because those languages have no such
 * concept — a spurious diff in those fields is noise, not a breaking change.
 *
 * Policy: when the language is unknown (no capabilities registered, e.g. a
 * file extension we can't map), default to returning ALL diffs. Silently
 * hiding info when we're unsure is worse than a bit of noise.
 *
 * This helper is the single source of truth for the capability gate —
 * `computeFunctionRisk` (risk scoring / truncation sort) and the render loop
 * (what shows in the CHANGED section) both consult it so they stay aligned.
 * `enrich.ts::caller_impact` uses an inline equivalent for per-field narration.
 */
export function applicableContractDiffs(fn: EnrichedFunction): ContractDiff[] {
    // Derive language from file_path — equivalent to `node.language` now that
    // `detectLang` (GraphNode side) and `languageOfFile` (resolver side) emit
    // the same canonical registry keys. Inline lookup keeps EnrichedFunction
    // free of a derived-redundant field.
    const lang = languageOfFile(fn.file_path);
    const caps = lang ? getCapabilitiesFor(lang) : null;
    if (!caps) {
        return fn.contract_diffs;
    }
    return fn.contract_diffs.filter((cd) => {
        if (cd.field === 'is_async' && !caps.hasAsync) {
            return false;
        }
        if (cd.field === 'throws' && !caps.hasExceptions) {
            return false;
        }
        if (cd.field === 'decorators' && !caps.hasDecorators) {
            return false;
        }
        return true;
    });
}

/**
 * Compute a per-function risk score (0–1) for truncation sorting.
 * Higher = riskier = shown first.
 */
export function computeFunctionRisk(fn: EnrichedFunction): number {
    const hasContractDiff = applicableContractDiffs(fn).length > 0 ? 1 : 0;
    const callersNorm = Math.min(fn.callers.length / 10, 1);
    const isUntested = fn.has_test_coverage ? 0 : 1;
    const isModified = fn.is_new ? 0 : 1; // modified > new (can break existing callers)
    const sizeNorm = Math.min((fn.line_end - fn.line_start) / 100, 1);

    return hasContractDiff * 0.3 + callersNorm * 0.25 + isUntested * 0.2 + isModified * 0.15 + sizeNorm * 0.1;
}

/**
 * Compact prompt format optimized for LLM agent consumption.
 *
 * Design principles (derived from Langsmith trace analysis):
 * - Agent forms hypotheses on FIRST LLM call using graph + diff → dense signal, no noise
 * - Agent then uses grep/readFile with names from the graph → names must be grepable (file:line)
 * - Inheritance enables cross-class comparison (e.g. sibling method implementations) → keep hierarchy
 * - Test Gaps list and Structural Changes were never referenced by agent → removed
 * - Contract changes on callers are high-value signals → inline with ⚠
 * - Flows show how HTTP/test paths cross changed code → inline per function
 */
export function formatPrompt(output: ContextV2Output, opts?: PromptFormatterOptions): string {
    const { analysis } = output;
    const lines: string[] = [];

    const risk = analysis.risk;
    const br = analysis.blast_radius;
    const meta = analysis.metadata;

    // ── Header: one-line stats (untested scoped to changed functions only) ──
    const changedUntested = analysis.changed_functions.filter((f) => !f.has_test_coverage).length;
    lines.push(
        `${meta.changed_functions_count} changed (${changedUntested} untested) | ${br.total_functions} impacted | ${br.total_files} files | risk ${risk.level} ${risk.score}`,
    );
    lines.push('');

    const maxFunctions = opts?.maxFunctions ?? DEFAULT_MAX_FUNCTIONS;
    const maxPromptChars = opts?.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;

    // ── Changed functions (sorted by risk, truncated) ──
    if (analysis.changed_functions.length > 0) {
        // Pre-index affected_flows for O(1) lookup during rendering
        const affectedFlowsByEntry = new Map<string, (typeof analysis.affected_flows)[number]>();
        for (const flow of analysis.affected_flows) {
            affectedFlowsByEntry.set(flow.entry_point, flow);
        }

        // Sort by per-function risk (highest first)
        const sorted = [...analysis.changed_functions].sort((a, b) => computeFunctionRisk(b) - computeFunctionRisk(a));

        const totalFunctions = sorted.length;
        const truncated = sorted.slice(0, maxFunctions);
        const wasTruncated = totalFunctions > maxFunctions;

        lines.push('CHANGED:');

        // Build a set of qualified names that have siblings (same method name in sibling classes)
        const siblingMap = buildSiblingMap(analysis, output);

        for (const fn of truncated) {
            const status = fn.is_new ? 'new' : fn.diff_changes.length > 0 ? 'modified' : 'unchanged';
            const tested = fn.has_test_coverage ? 'tested' : 'untested';

            // Class-qualified signature for methods (language-agnostic via qualified_name)
            const displayName = classQualifiedSignature(fn.qualified_name, fn.signature);

            // Main line
            lines.push(
                `  ${displayName} [${fn.file_path}:${fn.line_start}-${fn.line_end}] ${status} | ${fn.callers.length} callers | ${tested}`,
            );

            // Contract changes — high value for agent to spot breaking changes.
            // `applicableContractDiffs` drops fields the language doesn't semantically
            // support (same gate used by `computeFunctionRisk` and `enrich.ts` so
            // render, risk scoring, and caller_impact narration stay aligned).
            for (const cd of applicableContractDiffs(fn)) {
                if (cd.field === 'params') {
                    const r = renderParamsDiff(cd.old_value, cd.new_value);
                    if (r.mode === 'simple') {
                        lines.push(`    ⚠ params: ${r.text}`);
                    } else {
                        lines.push(`    ⚠ params changed:`);
                        for (const tokLine of r.text.split('\n')) {
                            lines.push(`        ${tokLine}`);
                        }
                    }
                } else if (cd.field === 'return_type') {
                    const r = renderReturnTypeDiff(cd.old_value, cd.new_value);
                    if (r.mode === 'simple') {
                        lines.push(`    ⚠ return_type: ${r.text}`);
                    } else {
                        lines.push(`    ⚠ return_type changed:`);
                        for (const tokLine of r.text.split('\n')) {
                            lines.push(`        ${tokLine}`);
                        }
                    }
                } else {
                    lines.push(`    ⚠ ${cd.field}: ${cd.old_value} → ${cd.new_value}`);
                }
            }
            if (fn.caller_impact) {
                lines.push(`    ⚠ ${fn.caller_impact}`);
            }

            // Callers (← notation) — top N, then summary
            if (fn.callers.length > 0) {
                const MAX_CALLERS = 5;
                const shown = fn.callers.slice(0, MAX_CALLERS);
                for (const c of shown) {
                    const conf = c.confidence < 0.85 ? ` ~${Math.round(c.confidence * 100)}%` : '';
                    lines.push(`    ← ${c.name} [${c.file_path}:${c.line}]${conf}`);
                    // Surface non-picked candidates so the LLM can see what the
                    // resolver passed over at the ambiguous (0.30) tier.
                    if (c.confidence <= 0.3 && c.alternatives && c.alternatives.length > 0) {
                        const altSlice = c.alternatives.slice(0, MAX_ALTERNATIVES_RENDERED).join(', ');
                        const extra =
                            c.alternatives.length > MAX_ALTERNATIVES_RENDERED
                                ? `, +${c.alternatives.length - MAX_ALTERNATIVES_RENDERED} more`
                                : '';
                        lines.push(`      Alternatives considered: ${altSlice}${extra}`);
                    }
                }
                if (fn.callers.length > MAX_CALLERS) {
                    const remaining = fn.callers.slice(MAX_CALLERS);
                    const uniqueFiles = new Set(remaining.map((c) => c.file_path)).size;
                    lines.push(`    ... +${remaining.length} callers in ${uniqueFiles} files`);
                }
            }

            // Callees (→ compact chain)
            if (fn.callees.length > 0) {
                const MAX_CALLEES = 8;
                const names = fn.callees.slice(0, MAX_CALLEES).map((c) => c.name);
                let calleeLine = `    → ${names.join(', ')}`;
                if (fn.callees.length > MAX_CALLEES) {
                    calleeLine += `, ... +${fn.callees.length - MAX_CALLEES}`;
                }
                lines.push(calleeLine);
            }

            // Similar: sibling class with same method name — enables cross-class comparison
            const siblings = siblingMap.get(fn.qualified_name);
            if (siblings && siblings.length > 0) {
                for (const sib of siblings) {
                    lines.push(`    similar: ${sib.name} [${sib.file_path}:${sib.line_start}]`);
                }
            }

            // Affected flows inline
            if (fn.in_flows.length > 0) {
                const MAX_FLOWS = 3;
                let flowCount = 0;
                for (const ep of fn.in_flows) {
                    if (flowCount >= MAX_FLOWS) {
                        lines.push(`    ... +${fn.in_flows.length - MAX_FLOWS} flows`);
                        break;
                    }
                    const flow = affectedFlowsByEntry.get(ep);
                    if (flow) {
                        const prefix = flow.type === 'http' ? 'HTTP' : 'TEST';
                        const path = flow.path.map((q) => shortName(q)).join(' → ');
                        lines.push(`    flow: ${prefix} ${path}`);
                    }
                    flowCount++;
                }
            }

            lines.push('');
        }

        if (wasTruncated) {
            lines.push(`⚠ Showing top ${maxFunctions} of ${totalFunctions} changed functions (sorted by risk)`);
            lines.push('');
        }
    }

    // ── Imports for changed files (helps agent spot missing/new dependencies) ──
    const importLines = buildImportsSection(output, analysis);
    if (importLines.length > 0) {
        lines.push('IMPORTS:');
        for (const line of importLines) {
            lines.push(line);
        }
        lines.push('');
    }

    // ── Hierarchy (compact) ──
    if (analysis.inheritance.length > 0) {
        lines.push('HIERARCHY:');
        for (const entry of analysis.inheritance) {
            const name = shortName(entry.qualified_name);
            const parts: string[] = [];
            if (entry.extends) {
                parts.push(`extends ${shortName(entry.extends)}`);
            }
            if (entry.implements.length > 0) {
                parts.push(`impl ${entry.implements.map((i) => shortName(i)).join(', ')}`);
            }
            let line = `  ${name}`;
            if (parts.length > 0) {
                line += ` ${parts.join(' | ')}`;
            }
            if (entry.children.length > 0) {
                line += ` | children: ${entry.children.map((c) => shortName(c)).join(', ')}`;
            }
            lines.push(line);
        }
        lines.push('');
    }

    // ── Blast radius by depth (with confidence, category, flows) ──
    const byDepth = analysis.blast_radius.by_depth;
    const depthKeys = Object.keys(byDepth).sort();
    if (depthKeys.length > 0) {
        lines.push('BLAST RADIUS:');
        for (const depth of depthKeys) {
            const entries = byDepth[depth];

            // Group by impact_category
            const byCategory = new Map<ImpactCategory, typeof entries>();
            for (const entry of entries) {
                const cat = entry.impact_category;
                if (!byCategory.has(cat)) {
                    byCategory.set(cat, []);
                }
                byCategory.get(cat)!.push(entry);
            }

            // Render each category group (deterministic order: contract_breaking → behavior_affected → transitive)
            const categoryOrder: ImpactCategory[] = ['contract_breaking', 'behavior_affected', 'transitive'];
            const sortedCategories = [...byCategory.entries()].sort(
                (a, b) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0]),
            );

            for (const [category, catEntries] of sortedCategories) {
                const MAX_SHOW = 6;
                const shown = catEntries.slice(0, MAX_SHOW);
                const names = shown.map((e) => {
                    const name = shortName(e.qualified_name);
                    const conf = `${Math.round(e.accumulated_confidence * 100)}%`;
                    const score = e.impact_score > 0 ? `, score ${e.impact_score.toFixed(2)}` : '';
                    return `${name} (${conf}${score})`;
                });

                let line = `  depth ${depth} [${category}]: ${names.join(', ')}`;
                if (catEntries.length > MAX_SHOW) {
                    line += ` ... +${catEntries.length - MAX_SHOW}`;
                }
                line += ` (${catEntries.length})`;
                lines.push(line);

                // Show flows for this group (compact)
                const allFlows = shown.flatMap((e) => e.flows);
                if (allFlows.length > 0) {
                    const uniqueFlows = new Map<string, string>();
                    for (const f of allFlows) {
                        if (!uniqueFlows.has(f.entry_point)) {
                            uniqueFlows.set(f.entry_point, f.type === 'http' ? 'HTTP' : 'TEST');
                        }
                    }
                    const flowNames = [...uniqueFlows.entries()]
                        .slice(0, 3)
                        .map(([ep, type]) => `${type} ${shortName(ep)}`);
                    let flowLine = `    flows: ${flowNames.join(', ')}`;
                    if (uniqueFlows.size > 3) {
                        flowLine += ` ... +${uniqueFlows.size - 3}`;
                    }
                    lines.push(flowLine);
                }

                // Contract breaking warning
                if (category === 'contract_breaking') {
                    lines.push('    \u26a0 callers may need update (contract changed)');
                }
            }
        }
        lines.push('');
    }

    // ── Char-level truncation: drop sections from bottom (BLAST RADIUS → IMPORTS) if over limit ──
    let result = lines.join('\n');
    if (result.length > maxPromptChars) {
        // Try removing BLAST RADIUS first, then IMPORTS
        for (const section of ['BLAST RADIUS:', 'IMPORTS:']) {
            const idx = result.indexOf(`\n${section}\n`);
            if (idx !== -1) {
                // Find the end of this section (next section start or end of string)
                const afterSection = result.indexOf('\n\n', idx + section.length + 2);
                if (afterSection !== -1) {
                    result = result.slice(0, idx) + result.slice(afterSection);
                } else {
                    result = result.slice(0, idx);
                }
            }
            if (result.length <= maxPromptChars) {
                break;
            }
        }
        // Hard truncate as last resort
        if (result.length > maxPromptChars) {
            result = `${result.slice(0, maxPromptChars - 60)}\n\n⚠ Prompt truncated at ${maxPromptChars} chars`;
        }
    }

    return result;
}

// ── Helpers ──

/** Extract short name from qualified_name (e.g. "mod::Class::method" → "method") */
function shortName(qualifiedName: string): string {
    return qualifiedName.split('::').pop() || qualifiedName;
}

/**
 * Build class-qualified signature for methods.
 * "file::Class::method" + "method(params) -> ret" → "Class.method(params) -> ret"
 * For top-level functions ("file::func"), returns signature as-is.
 * Language-agnostic: works for any language since qualified_name always uses "::" separator.
 */
function classQualifiedSignature(qualifiedName: string, signature: string): string {
    const parts = qualifiedName.split('::');
    if (parts.length < 3) {
        return signature; // top-level function, no class
    }
    const className = parts[parts.length - 2];
    return `${className}.${signature}`;
}

/**
 * Build a map of changed functions → sibling implementations.
 * A "sibling" is a function with the same method name in a class that shares
 * the same parent (extends same base). This enables cross-class comparison
 * (e.g. OptimizedCursorPaginator.get_item_key vs DateTimePaginator.get_item_key).
 *
 * Uses full graph edges (not just analysis.inheritance which is filtered to changed files).
 */
function buildSiblingMap(
    analysis: ContextV2Output['analysis'],
    output: ContextV2Output,
): Map<string, Array<{ name: string; file_path: string; line_start: number }>> {
    const result = new Map<string, Array<{ name: string; file_path: string; line_start: number }>>();

    // Build parent→children index from ALL INHERITS edges in the graph (not just changed files)
    const parentToChildren = new Map<string, string[]>();
    for (const edge of output.graph.edges) {
        if (edge.kind !== 'INHERITS') {
            continue;
        }
        const existing = parentToChildren.get(edge.target_qualified) || [];
        existing.push(edge.source_qualified);
        parentToChildren.set(edge.target_qualified, existing);
    }

    // Index nodes by qualified name for fast lookup
    const nodeByQN = new Map(output.graph.nodes.map((n) => [n.qualified_name, n]));

    // For each changed function, find if its class has siblings with the same method
    const changedQNs = new Set(analysis.changed_functions.map((f) => f.qualified_name));

    for (const fn of analysis.changed_functions) {
        // Extract class name from qualified_name (e.g. "file::Class::method" → "file::Class")
        const parts = fn.qualified_name.split('::');
        if (parts.length < 3) {
            continue; // need at least file::class::method
        }

        const methodName = parts[parts.length - 1];
        const className = parts.slice(0, -1).join('::');

        // Find what this class extends (from INHERITS edges)
        const parentEdge = output.graph.edges.find((e) => e.kind === 'INHERITS' && e.source_qualified === className);
        if (!parentEdge) {
            continue;
        }

        // Find sibling classes (same parent)
        const siblings = parentToChildren.get(parentEdge.target_qualified) || [];

        for (const siblingClass of siblings) {
            if (siblingClass === className) {
                continue;
            }

            // Look for same method name in sibling class
            const siblingMethodQN = `${siblingClass}::${methodName}`;
            // Don't list if the sibling is also in changed functions (it's already shown)
            if (changedQNs.has(siblingMethodQN)) {
                continue;
            }

            const siblingNode = nodeByQN.get(siblingMethodQN);
            if (siblingNode) {
                const existing = result.get(fn.qualified_name) || [];
                existing.push({
                    name: `${shortName(siblingClass)}.${methodName}`,
                    file_path: siblingNode.file_path,
                    line_start: siblingNode.line_start,
                });
                result.set(fn.qualified_name, existing);
            }
        }
    }

    return result;
}

/**
 * Build compact IMPORTS section for changed files.
 * Shows each import edge from a changed file with:
 *   - NEW tag if the import was added in this change (not in oldGraph)
 *   - ⚠ UNRESOLVED if the import target has no corresponding node in the graph
 * Groups by source file for readability.
 */
function buildImportsSection(output: ContextV2Output, analysis: ContextV2Output['analysis']): string[] {
    const changedFiles = new Set(analysis.structural_diff.changed_files);

    // Collect IMPORTS edges from changed files
    const importEdges = output.graph.edges.filter((e) => e.kind === 'IMPORTS' && changedFiles.has(e.file_path));

    if (importEdges.length === 0) {
        return [];
    }

    // Set of new import edges (added in this diff)
    const newImportKeys = new Set(
        analysis.structural_diff.edges.added
            .filter((e) => e.kind === 'IMPORTS')
            .map((e) => `${e.source_qualified}→${e.target_qualified}`),
    );

    // Set of all node qualified names — to detect unresolved targets
    const allNodes = new Set(output.graph.nodes.map((n) => n.qualified_name));

    // Group by source file
    const byFile = new Map<string, typeof importEdges>();
    for (const edge of importEdges) {
        const existing = byFile.get(edge.file_path) || [];
        existing.push(edge);
        byFile.set(edge.file_path, existing);
    }

    const lines: string[] = [];
    for (const [filePath, edges] of byFile) {
        for (const edge of edges) {
            const key = `${edge.source_qualified}→${edge.target_qualified}`;
            const tags: string[] = [];

            if (newImportKeys.has(key)) {
                tags.push('NEW');
            }

            // Check if target exists as a node in the graph
            // For IMPORTS, target_qualified is usually "file::Symbol".
            // If neither the exact target nor any node starting with the target exists, it's unresolved.
            let targetExists = allNodes.has(edge.target_qualified);
            if (!targetExists) {
                const prefix = `${edge.target_qualified}::`;
                for (const qn of allNodes) {
                    if (qn.startsWith(prefix)) {
                        targetExists = true;
                        break;
                    }
                }
            }

            if (!targetExists) {
                tags.push('⚠ UNRESOLVED');
            }

            const tagStr = tags.length > 0 ? ` (${tags.join(', ')})` : '';
            lines.push(`  ${filePath} → ${shortName(edge.target_qualified)}${tagStr}`);
        }
    }

    return lines;
}
