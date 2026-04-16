import type { ContextV2Output } from './context-builder';
import type { ContractDiff } from './diff';
import { computeFunctionRisk } from './prompt-formatter';
import type { EnrichedFunction } from '../graph/types';

export interface XmlFormatterOptions {
    maxFunctions?: number;
    maxCallersPerFunction?: number;
}

const DEFAULT_MAX_FUNCTIONS = 15;
const DEFAULT_MAX_CALLERS = 5;

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

export function formatXml(output: ContextV2Output, opts?: XmlFormatterOptions): string {
    const { analysis } = output;
    const maxFunctions = opts?.maxFunctions ?? DEFAULT_MAX_FUNCTIONS;
    const maxCallers = opts?.maxCallersPerFunction ?? DEFAULT_MAX_CALLERS;

    const changedUntested = analysis.changed_functions.filter((f) => !f.has_test_coverage).length;
    const totalCallers = analysis.changed_functions.reduce((sum, f) => sum + f.callers.length, 0);
    const risk = analysis.risk;

    const addedQualifiedNames = new Set(analysis.structural_diff.nodes.added.map((n) => n.qualified_name));

    // Build set of files that have test coverage (via TESTED_BY edges)
    const testedFiles = new Set(
        output.graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.file_path),
    );

    const lines: string[] = [];

    lines.push('<CallGraph>');
    lines.push(
        `  <Summary changedFunctions="${analysis.changed_functions.length}" untestedFunctions="${changedUntested}" impactedCallers="${totalCallers}" riskLevel="${risk.level}" riskScore="${risk.score}" />`,
    );

    // Sort by risk, take top N
    const sorted = [...analysis.changed_functions].sort((a, b) => computeFunctionRisk(b) - computeFunctionRisk(a));
    const truncated = sorted.slice(0, maxFunctions);

    for (const fn of truncated) {
        const displayName = escapeXml(classQualifiedName(fn.qualified_name, fn.name));
        const status = fn.is_new ? 'new' : fn.diff_changes.length > 0 ? 'modified' : 'unchanged';
        const tested = fn.has_test_coverage ? 'true' : 'false';

        lines.push('');
        lines.push(
            `  <ChangedFunction name="${displayName}" file="${escapeXml(fn.file_path)}" lines="${fn.line_start}-${fn.line_end}" tested="${tested}" status="${status}">`,
        );

        // WhatChanged
        const whatChanged = buildWhatChanged(fn);
        lines.push(`    <WhatChanged>${escapeXml(whatChanged)}</WhatChanged>`);

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

        // Detect new callees
        const newCallees = fn.callees.filter((c) => addedQualifiedNames.has(c.qualified_name));
        if (newCallees.length > 0) {
            signals.push({
                type: 'calls-new-function',
                severity: 'medium',
                text: `Calls ${newCallees.length} newly added function(s): ${newCallees.map((c) => c.name).join(', ')}`,
            });
        }

        // Detect throws on modified functions
        const graphNode = output.graph.nodes.find((n) => n.qualified_name === fn.qualified_name);
        if (graphNode?.throws?.length && !fn.is_new) {
            signals.push({
                type: 'has-throws',
                severity: 'medium',
                text: `Throws: ${graphNode.throws.join(', ')}`,
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
            const untestedCallerCount = fn.callers.filter((c) => !testedFiles.has(c.file_path)).length;
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

        // Callees
        if (fn.callees.length > 0) {
            lines.push('    <Callees>');
            for (const c of fn.callees) {
                const isNew = addedQualifiedNames.has(c.qualified_name);
                const newAttr = isNew ? ' new="true"' : '';
                lines.push(`      <Callee name="${escapeXml(c.name)}"${newAttr} />`);
            }
            lines.push('    </Callees>');
        }

        lines.push('  </ChangedFunction>');
    }

    if (sorted.length > maxFunctions) {
        lines.push('');
        lines.push(`  <!-- Showing top ${maxFunctions} of ${sorted.length} changed functions (sorted by risk) -->`);
    }

    // Hierarchy (compact)
    if (analysis.inheritance.length > 0) {
        lines.push('');
        lines.push('  <Hierarchy>');
        for (const entry of analysis.inheritance) {
            const name = escapeXml(shortName(entry.qualified_name));
            const attrs: string[] = [`name="${name}"`];
            if (entry.extends) attrs.push(`extends="${escapeXml(shortName(entry.extends))}"`);
            if (entry.implements.length > 0) {
                attrs.push(`implements="${escapeXml(entry.implements.map(shortName).join(', '))}"`);
            }
            if (entry.children.length > 0) {
                attrs.push(`children="${escapeXml(entry.children.map(shortName).join(', '))}"`);
            }
            lines.push(`    <Class ${attrs.join(' ')} />`);
        }
        lines.push('  </Hierarchy>');
    }

    lines.push('</CallGraph>');

    return lines.join('\n');
}
