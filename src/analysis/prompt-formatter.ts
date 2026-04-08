import type { ContextV2Output } from './context-builder';

export function formatPrompt(output: ContextV2Output): string {
    const { analysis } = output;
    const lines: string[] = [];

    // Header
    const risk = analysis.risk;
    const br = analysis.blast_radius;
    const meta = analysis.metadata;
    lines.push('# Code Review Context');
    lines.push('');
    lines.push(
        `Risk: ${risk.level} (${risk.score}) | ${br.total_functions} functions impacted across ${br.total_files} files | ${meta.untested_count} untested`,
    );
    lines.push('');

    // Changed functions
    if (analysis.changed_functions.length > 0) {
        lines.push('## Changed Functions');
        lines.push('');

        for (const fn of analysis.changed_functions) {
            lines.push(`### ${fn.signature}  [${fn.file_path}:${fn.line_start}-${fn.line_end}]`);

            // Status
            if (fn.is_new) {
                lines.push('Status: new');
            } else if (fn.diff_changes.length > 0) {
                lines.push(`Status: modified (${fn.diff_changes.join(', ')})`);
            } else {
                lines.push('Status: unchanged');
            }

            // Callers
            if (fn.callers.length > 0) {
                lines.push('Callers:');
                for (const c of fn.callers) {
                    const conf = c.confidence < 0.85 ? ` confidence=${c.confidence.toFixed(2)}` : '';
                    lines.push(`  - ${c.name}  [${c.file_path}:${c.line}]${conf}`);
                }
            } else {
                lines.push('Callers: none');
            }

            // Callees
            if (fn.callees.length > 0) {
                lines.push('Callees:');
                for (const c of fn.callees) {
                    lines.push(`  - ${c.signature}  [${c.file_path}]`);
                }
            } else {
                lines.push('Callees: none');
            }

            // Test coverage
            lines.push(`Test coverage: ${fn.has_test_coverage ? 'yes' : 'no'}`);

            // Affected flows
            if (fn.in_flows.length > 0) {
                lines.push('Affected flows:');
                for (const ep of fn.in_flows) {
                    const flow = analysis.affected_flows.find((f) => f.entry_point === ep);
                    if (flow) {
                        const prefix = flow.type === 'http' ? 'HTTP' : 'TEST';
                        lines.push(`  - ${prefix}: ${flow.path.map((q) => q.split('::').pop()).join(' → ')}`);
                    } else {
                        lines.push(`  - ${ep.split('::').pop()}`);
                    }
                }
            } else {
                lines.push('Affected flows: none');
            }

            lines.push('');
        }
    }

    // Inheritance
    if (analysis.inheritance.length > 0) {
        lines.push('## Inheritance');
        lines.push('');
        for (const entry of analysis.inheritance) {
            const name = entry.qualified_name.split('::').pop();
            const parts: string[] = [];
            if (entry.extends) {
                parts.push(`extends ${entry.extends.split('::').pop()}`);
            }
            if (entry.implements.length > 0) {
                parts.push(`implements ${entry.implements.map((i) => i.split('::').pop()).join(', ')}`);
            }
            lines.push(`- ${name} ${parts.join(', ')}`);
            if (entry.children.length > 0) {
                lines.push(`  Children: ${entry.children.map((c) => c.split('::').pop()).join(', ')}`);
            }
        }
        lines.push('');
    }

    // Blast radius by depth
    const byDepth = analysis.blast_radius.by_depth;
    const depthKeys = Object.keys(byDepth).sort();
    if (depthKeys.length > 0) {
        lines.push('## Blast Radius');
        lines.push('');
        for (const depth of depthKeys) {
            const names = byDepth[depth].map((q) => q.split('::').pop());
            lines.push(`Depth ${depth}: ${names.join(', ')} (${names.length} functions)`);
        }
        lines.push('');
    }

    // Test gaps
    if (analysis.test_gaps.length > 0) {
        lines.push('## Test Gaps');
        lines.push('');
        for (const gap of analysis.test_gaps) {
            const name = gap.function.split('::').pop();
            lines.push(`- ${name}  [${gap.file_path}:${gap.line_start}]`);
        }
        lines.push('');
    }

    // Structural diff
    const diff = analysis.structural_diff;
    const hasNodeChanges = diff.summary.added > 0 || diff.summary.removed > 0 || diff.summary.modified > 0;
    const hasEdgeChanges = diff.edges.added.length > 0 || diff.edges.removed.length > 0;

    if (hasNodeChanges || hasEdgeChanges) {
        lines.push('## Structural Changes');
        lines.push('');

        if (hasNodeChanges) {
            const parts: string[] = [];
            if (diff.summary.added > 0) {
                parts.push(`${diff.summary.added} added`);
            }
            if (diff.summary.removed > 0) {
                parts.push(`${diff.summary.removed} removed`);
            }
            if (diff.summary.modified > 0) {
                parts.push(`${diff.summary.modified} modified`);
            }
            lines.push(parts.join(', '));
        }

        if (diff.nodes.removed.length > 0) {
            lines.push('');
            lines.push('Removed:');
            for (const n of diff.nodes.removed) {
                const name = n.qualified_name.split('::').pop();
                lines.push(`  - [${n.kind}] ${name}  [${n.file_path}:${n.line_start}]`);
            }
        }

        if (diff.nodes.modified.length > 0) {
            lines.push('');
            lines.push('Modified:');
            for (const m of diff.nodes.modified) {
                const name = m.qualified_name.split('::').pop();
                lines.push(`  - ${name} (${m.changes.join(', ')})`);
            }
        }

        if (hasEdgeChanges) {
            lines.push('');
            lines.push('Dependency changes:');
            for (const e of diff.edges.added) {
                const src = e.source_qualified.split('::').pop();
                const tgt = e.target_qualified.split('::').pop();
                lines.push(`  + ${e.kind}: ${src} → ${tgt}`);
            }
            for (const e of diff.edges.removed) {
                const src = e.source_qualified.split('::').pop();
                const tgt = e.target_qualified.split('::').pop();
                lines.push(`  - ${e.kind}: ${src} → ${tgt}`);
            }
        }

        lines.push('');
    }

    return lines.join('\n');
}
