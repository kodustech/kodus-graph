import type { EnrichedFunction } from '../graph/types';
import type { ContextV2Output } from './context-builder';
import type { ContractDiff } from './diff';
import { computeFunctionRisk } from './prompt-formatter';

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

function shortName(qualifiedName: string): string {
    return qualifiedName.split('::').pop() || qualifiedName;
}

function classQualifiedName(qualifiedName: string, name: string): string {
    const parts = qualifiedName.split('::');
    if (parts.length < 3) return name;
    const className = parts[parts.length - 2];
    return `${className}.${name}`;
}

// ── ReviewFocus generation ──

function buildReviewFocusItems(functions: EnrichedFunction[], testedFunctionSet: Set<string>): string[] {
    const items: string[] = [];
    const seen = new Set<string>();

    for (const fn of functions) {
        // Exception propagation
        const throwsDiff = fn.contract_diffs.find((d) => d.field === 'throws');
        if (throwsDiff && fn.callers.length > 0) {
            const untestedCallers = fn.callers.filter((c) => !testedFunctionSet.has(c.qualified_name)).length;
            const key = `throws:${fn.qualified_name}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push(
                    `Verify ${untestedCallers > 0 ? `${untestedCallers} untested ` : ''}callers of ${classQualifiedName(fn.qualified_name, fn.name)} handle new exception: ${throwsDiff.new_value}`,
                );
            }
        }

        // Return type expansion
        const returnDiff = fn.contract_diffs.find((d) => d.field === 'return_type');
        if (returnDiff && fn.callers.length > 0) {
            const key = `return:${fn.qualified_name}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push(
                    `Check ${fn.callers.length} callers of ${classQualifiedName(fn.qualified_name, fn.name)} handle return type change: ${returnDiff.old_value} → ${returnDiff.new_value}`,
                );
            }
        }

        // Param changes
        const paramDiff = fn.contract_diffs.find((d) => d.field === 'params');
        if (paramDiff && fn.callers.length > 0) {
            const key = `params:${fn.qualified_name}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push(
                    `Verify ${fn.callers.length} callers of ${classQualifiedName(fn.qualified_name, fn.name)} pass correct params after signature change`,
                );
            }
        }

        // Untested high-risk functions (with or without contract diffs)
        if (!fn.has_test_coverage && fn.callers.length >= 3) {
            const key = `untested:${fn.qualified_name}`;
            if (!seen.has(key)) {
                seen.add(key);
                const detail = fn.contract_diffs.length > 0 ? 'has contract changes, ' : 'has body changes, ';
                items.push(
                    `${classQualifiedName(fn.qualified_name, fn.name)} ${detail}${fn.callers.length} callers, and no test coverage`,
                );
            }
        }
    }

    return items.slice(0, 5);
}

// ── CriticalPaths generation ──

interface CriticalPath {
    steps: Array<{ name: string; isNew?: boolean; annotation?: string }>;
    risk: string;
    severity: 'high' | 'medium';
}

function buildCriticalPaths(functions: EnrichedFunction[], addedQN: Set<string>, maxPaths: number): CriticalPath[] {
    const paths: CriticalPath[] = [];

    for (const fn of functions) {
        if (fn.contract_diffs.length === 0 && !fn.is_new) continue;

        const throwsDiff = fn.contract_diffs.find((d) => d.field === 'throws');
        const returnDiff = fn.contract_diffs.find((d) => d.field === 'return_type');
        const paramDiff = fn.contract_diffs.find((d) => d.field === 'params');

        // Build risk paths from callers through this function
        for (const caller of fn.callers.slice(0, 2)) {
            if (throwsDiff) {
                paths.push({
                    steps: [
                        { name: caller.name },
                        { name: classQualifiedName(fn.qualified_name, fn.name) },
                        { name: throwsDiff.new_value, isNew: true, annotation: 'throws' },
                    ],
                    risk: `Caller ${caller.name} may not catch ${throwsDiff.new_value}`,
                    severity: 'high',
                });
            } else if (returnDiff) {
                paths.push({
                    steps: [
                        { name: caller.name },
                        { name: classQualifiedName(fn.qualified_name, fn.name), annotation: 'return type changed' },
                    ],
                    risk: `Caller ${caller.name} may assume old return type: ${returnDiff.old_value}`,
                    severity: 'high',
                });
            } else if (paramDiff) {
                paths.push({
                    steps: [
                        { name: caller.name },
                        { name: classQualifiedName(fn.qualified_name, fn.name), annotation: 'params changed' },
                    ],
                    risk: `Caller ${caller.name} may pass wrong arguments`,
                    severity: 'medium',
                });
            }

            if (paths.length >= maxPaths) break;
        }

        if (paths.length >= maxPaths) break;
    }

    // Sort by severity (high first), then truncate
    return paths.sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1)).slice(0, maxPaths);
}

// ── WhatChanged ──

function buildWhatChanged(fn: EnrichedFunction): string {
    if (fn.is_new) return 'New function added';

    const parts: string[] = [];

    for (const cd of fn.contract_diffs) {
        switch (cd.field) {
            case 'params':
                parts.push(`Parameters changed: ${cd.old_value} → ${cd.new_value}`);
                break;
            case 'return_type':
                parts.push(`Return type changed: ${cd.old_value} → ${cd.new_value}`);
                break;
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
        case 'params':
            return {
                type: 'param-changed',
                severity: 'high',
                text: `Parameters changed: ${cd.old_value} → ${cd.new_value}`,
            };
        case 'return_type':
            return {
                type: 'return-type-changed',
                severity: 'high',
                text: `Return type changed: ${cd.old_value} → ${cd.new_value}`,
            };
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
    const testedByEdges = output.graph.edges.filter((e) => e.kind === 'TESTED_BY');
    const testedFunctionSet = new Set(testedByEdges.map((e) => e.source_qualified));
    const testedFileSet = new Set(testedByEdges.map((e) => e.source_qualified.split('::')[0]));

    // Sort by risk, take top N
    const sorted = [...analysis.changed_functions].sort((a, b) => computeFunctionRisk(b) - computeFunctionRisk(a));
    const truncated = sorted.slice(0, maxFunctions);

    const lines: string[] = [];

    lines.push('<CallGraph>');
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
        const displayName = escapeXml(classQualifiedName(fn.qualified_name, fn.name));
        const status = fn.is_new ? 'new' : fn.diff_changes.length > 0 ? 'modified' : 'unchanged';
        const tested = fn.has_test_coverage ? 'true' : 'false';

        lines.push('');
        lines.push(
            `  <ChangedFunction name="${displayName}" file="${escapeXml(fn.file_path)}" lines="${fn.line_start}-${fn.line_end}" tested="${tested}" status="${status}">`,
        );

        // WhatChanged
        lines.push(`    <WhatChanged>${escapeXml(buildWhatChanged(fn))}</WhatChanged>`);

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
                lines.push(
                    `      <Caller name="${escapeXml(c.name)}" file="${escapeXml(c.file_path)}" line="${c.line}" />`,
                );
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

    lines.push('</CallGraph>');

    return lines.join('\n');
}
