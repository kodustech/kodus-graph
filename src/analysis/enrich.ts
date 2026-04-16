import type { IndexedGraph } from '../graph/loader';
import type { CalleeRef, CallerRef, EnrichedFunction } from '../graph/types';
import type { ContractDiff, DiffResult } from './diff';
import type { Flow } from './flows';

export function enrichChangedFunctions(
    graph: IndexedGraph,
    changedFiles: string[],
    diff: DiffResult,
    allFlows: Flow[],
    minConfidence: number,
    onlyChanged: boolean = false,
): EnrichedFunction[] {
    const changedSet = new Set(changedFiles);

    // Pre-index diff results
    const addedSet = new Set(diff.nodes.added.map((n) => n.qualified_name));
    const modifiedMap = new Map(diff.nodes.modified.map((m) => [m.qualified_name, m]));

    // Pre-index TESTED_BY — function-level when available, file-level as fallback.
    // TESTED_BY edges: source_qualified = tested function/file, target_qualified = test.
    // We collect both the qualified names (precise) and file path prefixes (fallback).
    const testedByEdges = graph.edges.filter((e) => e.kind === 'TESTED_BY');
    const testedFunctions = new Set(testedByEdges.map((e) => e.source_qualified));
    const testedFiles = new Set(testedByEdges.map((e) => e.source_qualified.split('::')[0]));

    // Pre-index flows by function
    const flowsByFunction = new Map<string, string[]>();
    for (const flow of allFlows) {
        for (const qn of flow.path) {
            const list = flowsByFunction.get(qn);
            if (list) {
                if (!list.includes(flow.entry_point)) {
                    list.push(flow.entry_point);
                }
            } else {
                flowsByFunction.set(qn, [flow.entry_point]);
            }
        }
    }

    // Filter functions in changed files
    const changedFunctions = graph.nodes.filter((n) => {
        if (!changedSet.has(n.file_path)) {
            return false;
        }
        if (
            n.is_test ||
            n.kind === 'Constructor' ||
            n.kind === 'Class' ||
            n.kind === 'Interface' ||
            n.kind === 'Enum'
        ) {
            return false;
        }
        if (onlyChanged) {
            return addedSet.has(n.qualified_name) || modifiedMap.has(n.qualified_name);
        }
        return true;
    });

    // Pre-index INHERITS edges: child → parent qualified name
    const childToParent = new Map<string, string>();
    for (const edge of graph.edges) {
        if (edge.kind === 'INHERITS') {
            childToParent.set(edge.source_qualified, edge.target_qualified);
        }
    }

    return changedFunctions
        .sort((a, b) => a.file_path.localeCompare(b.file_path) || a.line_start - b.line_start)
        .map((node) => {
            // Callers — include both direct callers AND callers of the overridden parent method.
            // When code calls `base.method()`, the edge points to the parent class method,
            // so overrides show 0 callers without this inheritance resolution.
            const callers: CallerRef[] = [];
            const seenCallers = new Set<string>();

            const collectCallers = (targetQN: string) => {
                for (const edge of graph.reverseAdjacency.get(targetQN) || []) {
                    if (edge.kind !== 'CALLS') {
                        continue;
                    }
                    if (seenCallers.has(edge.source_qualified)) {
                        continue;
                    }
                    if ((edge.confidence ?? 1.0) < minConfidence) {
                        continue;
                    }
                    seenCallers.add(edge.source_qualified);
                    const sourceNode = graph.byQualified.get(edge.source_qualified);
                    callers.push({
                        qualified_name: edge.source_qualified,
                        name: sourceNode?.name || edge.source_qualified.split('::').pop() || 'unknown',
                        file_path: sourceNode?.file_path || edge.file_path,
                        line: edge.line,
                        confidence: edge.confidence ?? 1.0,
                    });
                }
            };

            // Direct callers
            collectCallers(node.qualified_name);

            // Inherited callers: if this is a method override, also collect callers of the parent method.
            // e.g. OptimizedCursorPaginator::get_result inherits callers of BasePaginator::get_result
            const qnParts = node.qualified_name.split('::');
            if (qnParts.length >= 3) {
                const methodName = qnParts[qnParts.length - 1];
                const className = qnParts.slice(0, -1).join('::');
                const parentClass = childToParent.get(className);
                if (parentClass) {
                    collectCallers(`${parentClass}::${methodName}`);
                }
            }

            // Callees
            const callees: CalleeRef[] = [];
            const seenCallees = new Set<string>();
            for (const edge of graph.adjacency.get(node.qualified_name) || []) {
                if (edge.kind !== 'CALLS') {
                    continue;
                }
                if (seenCallees.has(edge.target_qualified)) {
                    continue;
                }
                seenCallees.add(edge.target_qualified);
                const targetNode = graph.byQualified.get(edge.target_qualified);
                const name = targetNode?.name || edge.target_qualified.split('::').pop() || 'unknown';
                const params = targetNode?.params && targetNode.params !== '()' ? targetNode.params : '';
                const ret = targetNode?.return_type ? ` -> ${targetNode.return_type}` : '';
                callees.push({
                    qualified_name: edge.target_qualified,
                    name,
                    file_path: targetNode?.file_path || '',
                    signature: `${name}${params}${ret}`,
                });
            }

            // Signature
            const shortName = node.name.includes('.') ? node.name.split('.').pop()! : node.name;
            const params = node.params && node.params !== '()' ? node.params : '';
            const ret = node.return_type ? ` -> ${node.return_type}` : '';
            const signature = `${shortName}${params}${ret}`;

            // Diff
            const isNew = addedSet.has(node.qualified_name);
            const modifiedNode = modifiedMap.get(node.qualified_name);
            const diffChanges = isNew ? [] : modifiedNode?.changes || [];
            const contractDiffs: ContractDiff[] = isNew ? [] : (modifiedNode?.contract_diffs ?? []);

            // Caller impact
            let callerImpact: string | undefined;
            if (contractDiffs.length > 0 && callers.length > 0) {
                const impacts: string[] = [];
                const paramsDiff = contractDiffs.find((d) => d.field === 'params');
                const returnDiff = contractDiffs.find((d) => d.field === 'return_type');
                if (paramsDiff) {
                    impacts.push(`${callers.length} callers may need param update`);
                }
                if (returnDiff) {
                    impacts.push(`${callers.length} callers may assume old return type`);
                }
                const asyncDiff = contractDiffs.find((d) => d.field === 'is_async');
                if (asyncDiff) {
                    if (asyncDiff.new_value === 'true') {
                        impacts.push(`${callers.length} callers must add await (sync->async)`);
                    } else {
                        impacts.push(`${callers.length} callers may remove await (async->sync)`);
                    }
                }
                const throwsDiff = contractDiffs.find((d) => d.field === 'throws');
                if (throwsDiff) {
                    impacts.push(`${callers.length} callers may not handle new exception: ${throwsDiff.new_value}`);
                }
                callerImpact = impacts.length > 0 ? impacts.join('; ') : undefined;
            }

            return {
                qualified_name: node.qualified_name,
                name: node.name,
                parent_name: node.parent_name,
                kind: node.kind,
                signature,
                file_path: node.file_path,
                line_start: node.line_start,
                line_end: node.line_end,
                callers,
                callees,
                has_test_coverage: testedFunctions.has(node.qualified_name) || testedFiles.has(node.file_path),
                diff_changes: diffChanges,
                contract_diffs: contractDiffs,
                caller_impact: callerImpact,
                is_new: isNew,
                in_flows: flowsByFunction.get(node.qualified_name) || [],
            };
        });
}
