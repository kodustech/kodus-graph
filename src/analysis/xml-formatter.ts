import type { EnrichedFunction } from '../graph/types';
import { MAX_ALTERNATIVES_RENDERED } from './constants';
import type { ContextV2Output } from './context-builder';
import { renderParamsDiff, renderReturnTypeDiff } from './contract-diff-render';
import type { ContractDiff } from './diff';
import { computeFunctionRisk } from './prompt-formatter';

/** Short name from qualified_name (`file::Class::method` → `method`). */
function shortName(qualifiedName: string): string {
    return qualifiedName.split('::').pop() || qualifiedName;
}

export interface XmlFormatterOptions {
    maxFunctions?: number;
    maxCallersPerFunction?: number;
    maxCriticalPaths?: number;
}

const DEFAULT_MAX_FUNCTIONS = 15;
const DEFAULT_MAX_CALLERS = 5;
const DEFAULT_MAX_CRITICAL_PATHS = 5;

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Render how a CALLS edge was resolved, as XML attributes.
 *
 * The resolver grades every edge across five tiers — `receiver` (0.95, the
 * receiver's type is known), `di`, `same`, `import`, `unique` (0.60, nothing but
 * the name was unique) down to `ambiguous` (0.30, one of several candidates was
 * picked) — and this formatter used to emit them all identically:
 *
 *     <Caller name="login" file="src/app/login.ts" line="1" />
 *
 * A byte-identical rendering for a typed resolution and a name guess makes every
 * edge read as equally-asserted fact, which is precisely how a caller list turns
 * into a confident wrong answer. Naming the tier tells a reader *why* to trust
 * the edge, which is more actionable than a bare float; the number is kept for
 * anything that wants to threshold on it.
 */
function resolutionAttrs(ref: { confidence: number; tier?: string }): string {
    const tier = ref.tier ? ` tier="${escapeXml(ref.tier)}"` : '';
    return ` confidence="${ref.confidence.toFixed(2)}"${tier}`;
}

function classQualifiedName(qualifiedName: string, name: string, parentName?: string): string {
    // Prefer parent_name when parser populated it — authoritative across languages
    // (Python emits `file::Class.method`, TS/Java emits `file::Class::method`, etc.).
    if (parentName && parentName !== name) {
        return `${parentName}.${name}`;
    }
    // Fallback: parse from qualified_name for languages that encode class via `::`.
    const parts = qualifiedName.split('::');
    if (parts.length < 3) {
        return name;
    }
    const className = parts[parts.length - 2];
    return `${className}.${name}`;
}

// ── ReviewFocus generation ──

export function buildReviewFocusItems(functions: EnrichedFunction[], testedFunctionSet: Set<string>): string[] {
    const items: string[] = [];

    for (const fn of functions) {
        const throwsDiff = fn.contract_diffs.find((d) => d.field === 'throws');
        const returnDiff = fn.contract_diffs.find((d) => d.field === 'return_type');
        const paramDiff = fn.contract_diffs.find((d) => d.field === 'params');
        const untested = !fn.has_test_coverage && fn.callers.length >= 3;

        const hasConcern = Boolean(throwsDiff || returnDiff || paramDiff || untested);
        if (!hasConcern) {
            continue;
        }

        const qn = classQualifiedName(fn.qualified_name, fn.name, fn.parent_name);
        const callerCount = fn.callers.length;

        // Primary action phrase — priority order: throws > params > return > untested-only.
        // When multiple concerns are present the primary picks the most severe;
        // the rest become parenthetical secondary clauses.
        let primary = '';
        if (throwsDiff && callerCount > 0) {
            const untestedCallers = fn.callers.filter((c) => !testedFunctionSet.has(c.qualified_name)).length;
            const prefix = untestedCallers > 0 ? `${untestedCallers} untested ` : `${callerCount} `;
            primary = `Verify ${prefix}callers of ${qn} handle new exception: ${throwsDiff.new_value}`;
        } else if (paramDiff && callerCount > 0) {
            primary = `Verify ${callerCount} callers of ${qn} pass correct params after signature change`;
        } else if (returnDiff && callerCount > 0) {
            primary = `Check ${callerCount} callers of ${qn} handle return type change: ${returnDiff.old_value} → ${returnDiff.new_value}`;
        } else if (untested) {
            // No caller-facing contract change — lead with untested status.
            const detail = fn.contract_diffs.length > 0 ? 'has contract changes' : 'has body changes';
            primary = `${qn} ${detail}, ${callerCount} callers, and no test coverage`;
        }

        if (primary === '') {
            // Contract change(s) present but no callers and not untested-high-risk — skip.
            continue;
        }

        // Secondary concerns appended as additional clauses to the primary.
        const secondary: string[] = [];
        if (throwsDiff && !primary.includes('handle new exception')) {
            secondary.push(`new exception: ${throwsDiff.new_value}`);
        }
        if (returnDiff && !primary.includes('return type change')) {
            secondary.push(`return type change: ${returnDiff.old_value} → ${returnDiff.new_value}`);
        }
        if (paramDiff && !primary.includes('signature change')) {
            secondary.push('signature change');
        }
        if (untested && !primary.includes('no test coverage')) {
            secondary.push('no test coverage');
        }

        const sentence = secondary.length > 0 ? `${primary} (${secondary.join('; ')})` : primary;
        items.push(sentence);
    }

    return items.slice(0, 5);
}

// ── CriticalPaths generation ──

interface CriticalPath {
    steps: Array<{ name: string; isNew?: boolean; annotation?: string }>;
    risk: string;
    severity: 'high' | 'medium';
}

function buildCriticalPaths(functions: EnrichedFunction[], _addedQN: Set<string>, maxPaths: number): CriticalPath[] {
    const paths: CriticalPath[] = [];

    for (const fn of functions) {
        if (fn.contract_diffs.length === 0 && !fn.is_new) {
            continue;
        }

        const throwsDiff = fn.contract_diffs.find((d) => d.field === 'throws');
        const returnDiff = fn.contract_diffs.find((d) => d.field === 'return_type');
        const paramDiff = fn.contract_diffs.find((d) => d.field === 'params');

        // Build risk paths from callers through this function
        for (const caller of fn.callers.slice(0, 2)) {
            if (throwsDiff) {
                paths.push({
                    steps: [
                        { name: caller.name },
                        { name: classQualifiedName(fn.qualified_name, fn.name, fn.parent_name) },
                        { name: throwsDiff.new_value, isNew: true, annotation: 'throws' },
                    ],
                    risk: `Caller ${caller.name} may not catch ${throwsDiff.new_value}`,
                    severity: 'high',
                });
            } else if (returnDiff) {
                paths.push({
                    steps: [
                        { name: caller.name },
                        {
                            name: classQualifiedName(fn.qualified_name, fn.name, fn.parent_name),
                            annotation: 'return type changed',
                        },
                    ],
                    risk: `Caller ${caller.name} may assume old return type: ${returnDiff.old_value}`,
                    severity: 'high',
                });
            } else if (paramDiff) {
                paths.push({
                    steps: [
                        { name: caller.name },
                        {
                            name: classQualifiedName(fn.qualified_name, fn.name, fn.parent_name),
                            annotation: 'params changed',
                        },
                    ],
                    risk: `Caller ${caller.name} may pass wrong arguments`,
                    severity: 'medium',
                });
            }

            if (paths.length >= maxPaths) {
                break;
            }
        }

        if (paths.length >= maxPaths) {
            break;
        }
    }

    // Sort by severity (high first), then truncate
    return paths.sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1)).slice(0, maxPaths);
}

// ── WhatChanged ──

function buildWhatChanged(fn: EnrichedFunction): string {
    if (fn.is_new) {
        return 'New function added';
    }

    const parts: string[] = [];

    for (const cd of fn.contract_diffs) {
        switch (cd.field) {
            case 'params': {
                const r = renderParamsDiff(cd.old_value, cd.new_value);
                if (r.mode === 'simple') {
                    parts.push(`Parameters changed: ${r.text}`);
                } else {
                    const chunks: string[] = [];
                    if (r.added.length > 0) {
                        chunks.push(`added ${r.added.join(', ')}`);
                    }
                    if (r.removed.length > 0) {
                        chunks.push(`removed ${r.removed.join(', ')}`);
                    }
                    parts.push(
                        chunks.length > 0
                            ? `Parameters changed: ${chunks.join('; ')}`
                            : `Parameters changed: ${cd.old_value} → ${cd.new_value}`,
                    );
                }
                break;
            }
            case 'return_type': {
                const r = renderReturnTypeDiff(cd.old_value, cd.new_value);
                if (r.mode === 'simple') {
                    parts.push(`Return type changed: ${r.text}`);
                } else {
                    parts.push(`Return type changed (see ContractDiff)`);
                }
                break;
            }
            case 'is_async':
                parts.push(`Async modifier changed: ${cd.old_value} → ${cd.new_value}`);
                break;
            case 'modifiers':
                parts.push(`Modifiers changed: ${cd.old_value} → ${cd.new_value}`);
                break;
            case 'throws': {
                const oldSet = new Set(cd.old_value === '(none)' ? [] : cd.old_value.split(', '));
                const newSet = cd.new_value === '(none)' ? [] : cd.new_value.split(', ');
                const added = newSet.filter((t) => !oldSet.has(t));
                const removed = [...oldSet].filter((t) => !new Set(newSet).has(t));
                if (added.length > 0) {
                    parts.push(`Now throws: ${added.join(', ')}`);
                }
                if (removed.length > 0) {
                    parts.push(`No longer throws: ${removed.join(', ')}`);
                }
                if (added.length === 0 && removed.length === 0) {
                    parts.push(`Throws changed: ${cd.old_value} → ${cd.new_value}`);
                }
                break;
            }
            case 'decorators':
                parts.push(`Decorators changed: ${cd.old_value} → ${cd.new_value}`);
                break;
        }
    }

    if (fn.diff_changes.some((c) => c.includes('body'))) {
        parts.push('Function body modified');
    }

    if (fn.caller_impact) {
        parts.push(fn.caller_impact);
    }

    return parts.length > 0 ? parts.join('. ') : 'Implementation modified';
}

// ── RiskSignals ──

function contractDiffToSignal(cd: ContractDiff): { type: string; severity: string; text: string } {
    switch (cd.field) {
        case 'params': {
            const r = renderParamsDiff(cd.old_value, cd.new_value);
            if (r.mode === 'simple') {
                return {
                    type: 'param-changed',
                    severity: 'high',
                    text: `Parameters changed: ${r.text}`,
                };
            }
            const chunks: string[] = [];
            if (r.added.length > 0) {
                chunks.push(`added ${r.added.join(', ')}`);
            }
            if (r.removed.length > 0) {
                chunks.push(`removed ${r.removed.join(', ')}`);
            }
            return {
                type: 'param-changed',
                severity: 'high',
                text:
                    chunks.length > 0
                        ? `Parameters changed: ${chunks.join('; ')}`
                        : `Parameters changed: ${cd.old_value} → ${cd.new_value}`,
            };
        }
        case 'return_type': {
            const r = renderReturnTypeDiff(cd.old_value, cd.new_value);
            if (r.mode === 'simple') {
                return {
                    type: 'return-type-changed',
                    severity: 'high',
                    text: `Return type changed: ${r.text}`,
                };
            }
            return {
                type: 'return-type-changed',
                severity: 'high',
                text: 'Return type changed (see ContractDiff)',
            };
        }
        case 'throws': {
            const oldSet = new Set(cd.old_value === '(none)' ? [] : cd.old_value.split(', '));
            const newItems = cd.new_value === '(none)' ? [] : cd.new_value.split(', ');
            const added = newItems.filter((t) => !oldSet.has(t));
            const text =
                added.length > 0
                    ? `New exception(s) thrown: ${added.join(', ')}`
                    : `Throws changed: ${cd.old_value} → ${cd.new_value}`;
            return { type: 'throws-changed', severity: 'high', text };
        }
        case 'is_async':
            return {
                type: 'async-changed',
                severity: 'high',
                text: `Async modifier changed: ${cd.old_value} → ${cd.new_value}`,
            };
        case 'modifiers':
            return {
                type: 'modifier-changed',
                severity: 'medium',
                text: `Modifiers changed: ${cd.old_value} → ${cd.new_value}`,
            };
        case 'decorators':
            return {
                type: 'decorator-changed',
                severity: 'low',
                text: `Decorators changed: ${cd.old_value} → ${cd.new_value}`,
            };
    }
}

// ── Main formatter ──

export function formatXml(output: ContextV2Output, opts?: XmlFormatterOptions): string {
    const { analysis } = output;
    const maxFunctions = opts?.maxFunctions ?? DEFAULT_MAX_FUNCTIONS;
    const maxCallers = opts?.maxCallersPerFunction ?? DEFAULT_MAX_CALLERS;
    const maxPaths = opts?.maxCriticalPaths ?? DEFAULT_MAX_CRITICAL_PATHS;

    const changedUntested = analysis.changed_functions.filter((f) => !f.has_test_coverage).length;
    const totalCallers = analysis.changed_functions.reduce((sum, f) => sum + f.callers.length, 0);
    const risk = analysis.risk;

    const addedQN = new Set(analysis.structural_diff.nodes.added.map((n) => n.qualified_name));

    // Build tested-function set for precise coverage checks.
    // TESTED_BY edges: source_qualified = tested function/file, target_qualified = test.
    // Symbol-level TESTED_BY comes from a resolved call out of a test; file-level
    // is the coarse filename fallback for languages whose test calls don't
    // resolve. Splitting `::` off every edge collapses the first into the second,
    // letting one tested function vouch for its whole file.
    const testedByEdges = output.graph.edges.filter((e) => e.kind === 'TESTED_BY');
    const testedFunctionSet = new Set(
        testedByEdges.filter((e) => e.source_qualified.includes('::')).map((e) => e.source_qualified),
    );
    const testedFileSet = new Set(
        testedByEdges.filter((e) => !e.source_qualified.includes('::')).map((e) => e.source_qualified),
    );

    // Sort by risk, take top N
    const sorted = [...analysis.changed_functions].sort((a, b) => computeFunctionRisk(b) - computeFunctionRisk(a));
    const truncated = sorted.slice(0, maxFunctions);

    const lines: string[] = [];

    lines.push('<CallGraph>');
    // State the limits up front. Everything below is static analysis of this
    // repository at one commit: it cannot see reflection, dynamic dispatch,
    // string-keyed lookups, DI wired at runtime, or any consumer outside this
    // repo. Left unsaid, a ranked, confident-looking map gets read as ground
    // truth, and "no callers" becomes "safe to change" — the single most
    // expensive misreading available here.
    lines.push('  <!-- Static analysis of this repo at one commit. Absence here is not absence in the codebase:');
    lines.push('       reflection, dynamic dispatch and external consumers are invisible. Each edge carries the');
    lines.push('       tier and confidence it was resolved with — verify low-confidence claims with the tools');
    lines.push('       before acting on them. Reason from this map; answer from the code. -->');
    lines.push(
        `  <Summary changedFunctions="${analysis.changed_functions.length}" untestedFunctions="${changedUntested}" impactedCallers="${totalCallers}" riskLevel="${risk.level}" riskScore="${risk.score}" />`,
    );

    // ReviewFocus
    const focusItems = buildReviewFocusItems(truncated, testedFunctionSet);
    if (focusItems.length > 0) {
        lines.push('');
        lines.push('  <ReviewFocus>');
        for (const item of focusItems) {
            lines.push(`    <Focus>${escapeXml(item)}</Focus>`);
        }
        lines.push('  </ReviewFocus>');
    }

    // CriticalPaths
    const criticalPaths = buildCriticalPaths(truncated, addedQN, maxPaths);
    if (criticalPaths.length > 0) {
        lines.push('');
        lines.push('  <CriticalPaths>');
        for (const path of criticalPaths) {
            lines.push(`    <Path risk="${path.severity}">`);
            for (const step of path.steps) {
                const newAttr = step.isNew ? ' new="true"' : '';
                const annoAttr = step.annotation ? ` annotation="${escapeXml(step.annotation)}"` : '';
                lines.push(`      <Step${newAttr}${annoAttr}>${escapeXml(step.name)}</Step>`);
            }
            lines.push(`      <Risk>${escapeXml(path.risk)}</Risk>`);
            lines.push('    </Path>');
        }
        lines.push('  </CriticalPaths>');
    }

    // ChangedFunctions
    for (const fn of truncated) {
        const displayName = escapeXml(classQualifiedName(fn.qualified_name, fn.name, fn.parent_name));
        const status = fn.is_new ? 'new' : fn.diff_changes.length > 0 ? 'modified' : 'unchanged';
        const tested = fn.has_test_coverage ? 'true' : 'false';
        // Tells the reader how to weigh `<Callers>`: exhaustive for a private
        // symbol, a lower bound for an exported one (package consumers, dynamic
        // imports and downstream services are outside this graph).
        const exported = fn.is_exported !== undefined ? ` exported="${fn.is_exported ? 'true' : 'false'}"` : '';

        lines.push('');
        lines.push(
            `  <ChangedFunction name="${displayName}" file="${escapeXml(fn.file_path)}" lines="${fn.line_start}-${fn.line_end}" tested="${tested}" status="${status}"${exported}>`,
        );

        // WhatChanged
        lines.push(`    <WhatChanged>${escapeXml(buildWhatChanged(fn))}</WhatChanged>`);

        // ContractDiffs — emit structured elements only for long params/return_type
        // (short cases are already fully represented in WhatChanged/RiskSignals).
        for (const cd of fn.contract_diffs) {
            if (cd.field === 'params') {
                const r = renderParamsDiff(cd.old_value, cd.new_value);
                if (r.mode === 'token') {
                    lines.push(`    <ContractDiff field="params">`);
                    for (const rm of r.removed) {
                        lines.push(`      <Removed>${escapeXml(rm)}</Removed>`);
                    }
                    for (const add of r.added) {
                        lines.push(`      <Added>${escapeXml(add)}</Added>`);
                    }
                    lines.push(`    </ContractDiff>`);
                }
            } else if (cd.field === 'return_type') {
                const r = renderReturnTypeDiff(cd.old_value, cd.new_value);
                if (r.mode === 'long') {
                    lines.push(`    <ContractDiff field="return_type">`);
                    lines.push(`      <Before>${escapeXml(cd.old_value)}</Before>`);
                    lines.push(`      <After>${escapeXml(cd.new_value)}</After>`);
                    lines.push(`    </ContractDiff>`);
                }
            }
        }

        // RiskSignals
        const signals: Array<{ type: string; severity: string; text: string }> = [];

        for (const cd of fn.contract_diffs) {
            signals.push(contractDiffToSignal(cd));
        }

        if (!fn.has_test_coverage && fn.callers.length > 0) {
            signals.push({
                type: 'untested-with-callers',
                severity: 'high',
                text: `${fn.callers.length} callers depend on this untested function`,
            });
        }

        const newCallees = fn.callees.filter((c) => addedQN.has(c.qualified_name));
        if (newCallees.length > 0) {
            signals.push({
                type: 'calls-new-function',
                severity: 'medium',
                text: `Calls ${newCallees.length} newly added function(s): ${newCallees.map((c) => c.name).join(', ')}`,
            });
        }

        if (signals.length > 0) {
            lines.push('    <RiskSignals>');
            for (const signal of signals) {
                lines.push(
                    `      <Signal type="${signal.type}" severity="${signal.severity}">${escapeXml(signal.text)}</Signal>`,
                );
            }
            lines.push('    </RiskSignals>');
        }

        // Callers
        if (fn.callers.length > 0) {
            const untestedCallerCount = fn.callers.filter(
                (c) => !testedFunctionSet.has(c.qualified_name) && !testedFileSet.has(c.file_path),
            ).length;
            const shownCallers = fn.callers.slice(0, maxCallers);

            lines.push(`    <Callers count="${fn.callers.length}" untestedCount="${untestedCallerCount}">`);
            for (const c of shownCallers) {
                const isAmbiguous = c.confidence <= 0.3 && c.alternatives && c.alternatives.length > 0;
                if (isAmbiguous && c.alternatives && c.alternatives.length > 0) {
                    const alts = c.alternatives;
                    lines.push(
                        `      <Caller name="${escapeXml(c.name)}" file="${escapeXml(c.file_path)}" line="${c.line}"${resolutionAttrs(c)}>`,
                    );
                    lines.push('        <Alternatives>');
                    const shownAlts = alts.slice(0, MAX_ALTERNATIVES_RENDERED);
                    for (const alt of shownAlts) {
                        lines.push(`          <Alt>${escapeXml(alt)}</Alt>`);
                    }
                    if (alts.length > MAX_ALTERNATIVES_RENDERED) {
                        lines.push(`          <!-- +${alts.length - MAX_ALTERNATIVES_RENDERED} more -->`);
                    }
                    lines.push('        </Alternatives>');
                    lines.push('      </Caller>');
                } else {
                    lines.push(
                        `      <Caller name="${escapeXml(c.name)}" file="${escapeXml(c.file_path)}" line="${c.line}"${resolutionAttrs(c)} />`,
                    );
                }
            }
            if (fn.callers.length > maxCallers) {
                const remaining = fn.callers.length - maxCallers;
                const uniqueFiles = new Set(fn.callers.slice(maxCallers).map((c) => c.file_path)).size;
                lines.push(`      <!-- +${remaining} callers in ${uniqueFiles} files -->`);
            }
            lines.push('    </Callers>');
        }

        lines.push('  </ChangedFunction>');
    }

    if (sorted.length > maxFunctions) {
        lines.push('');
        lines.push(`  <!-- Showing top ${maxFunctions} of ${sorted.length} changed functions (sorted by risk) -->`);
    }

    // ── Imports (mirrors the prompt format's IMPORTS section). Emitted
    //    whenever the changed files have IMPORTS edges so the XML consumer
    //    gets the same baseline signal as the prompt consumer — especially
    //    important when changedFunctions=0 (XML would otherwise be near-empty
    //    while the prompt shows real content).
    const importsEntries = buildImportsEntries(output);
    if (importsEntries.length > 0) {
        lines.push('');
        lines.push('  <Imports>');
        for (const entry of importsEntries) {
            const newAttr = entry.isNew ? ' new="true"' : '';
            const unresolvedAttr = entry.unresolved ? ' unresolved="true"' : '';
            lines.push(
                `    <Import source="${escapeXml(entry.source)}" target="${escapeXml(entry.target)}"${newAttr}${unresolvedAttr} />`,
            );
        }
        lines.push('  </Imports>');
    }

    // ── Hierarchy (mirrors the prompt format's HIERARCHY section).
    if (analysis.inheritance.length > 0) {
        lines.push('');
        lines.push('  <Hierarchy>');
        for (const entry of analysis.inheritance) {
            const name = shortName(entry.qualified_name);
            const extendsAttr = entry.extends ? ` extends="${escapeXml(shortName(entry.extends))}"` : '';
            const implementsAttr =
                entry.implements.length > 0
                    ? ` implements="${escapeXml(entry.implements.map(shortName).join(', '))}"`
                    : '';
            if (entry.children.length > 0) {
                lines.push(`    <Class name="${escapeXml(name)}"${extendsAttr}${implementsAttr}>`);
                for (const child of entry.children) {
                    lines.push(`      <Child>${escapeXml(shortName(child))}</Child>`);
                }
                lines.push('    </Class>');
            } else {
                lines.push(`    <Class name="${escapeXml(name)}"${extendsAttr}${implementsAttr} />`);
            }
        }
        lines.push('  </Hierarchy>');
    }

    lines.push('</CallGraph>');

    return lines.join('\n');
}

// ── Imports entry helper ──

interface ImportEntry {
    source: string;
    target: string;
    isNew: boolean;
    unresolved: boolean;
}

/**
 * Build the deduplicated `<Import>` entries for the XML format — same data
 * as the prompt formatter's IMPORTS section (one line per unique
 * `source_file → target`), but emitted as attributed XML.
 */
function buildImportsEntries(output: ContextV2Output): ImportEntry[] {
    const { analysis } = output;
    const changedFiles = new Set(analysis.structural_diff.changed_files);

    const importEdges = output.graph.edges.filter((e) => e.kind === 'IMPORTS' && changedFiles.has(e.file_path));
    if (importEdges.length === 0) {
        return [];
    }

    const newImportKeys = new Set(
        analysis.structural_diff.edges.added
            .filter((e) => e.kind === 'IMPORTS')
            .map((e) => `${e.source_qualified}→${e.target_qualified}`),
    );
    const allNodes = new Set(output.graph.nodes.map((n) => n.qualified_name));

    const seen = new Set<string>();
    const entries: ImportEntry[] = [];
    for (const edge of importEdges) {
        const dedupKey = `${edge.file_path}→${edge.target_qualified}`;
        if (seen.has(dedupKey)) {
            continue;
        }
        seen.add(dedupKey);

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

        const key = `${edge.source_qualified}→${edge.target_qualified}`;
        entries.push({
            source: edge.file_path,
            target: edge.target_qualified,
            isNew: newImportKeys.has(key),
            unresolved: !targetExists,
        });
    }
    return entries;
}
