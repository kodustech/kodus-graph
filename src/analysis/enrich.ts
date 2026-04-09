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

    // Pre-index TESTED_BY
    const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.source_qualified));

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

    return changedFunctions
        .sort((a, b) => a.file_path.localeCompare(b.file_path) || a.line_start - b.line_start)
        .map((node) => {
            // Callers
            const callers: CallerRef[] = [];
            for (const edge of graph.reverseAdjacency.get(node.qualified_name) || []) {
                if (edge.kind !== 'CALLS') {
                    continue;
                }
                // null/undefined confidence = high confidence (edge came from DB or parser without scoring)
                if ((edge.confidence ?? 1.0) < minConfidence) {
                    continue;
                }
                const sourceNode = graph.byQualified.get(edge.source_qualified);
                callers.push({
                    qualified_name: edge.source_qualified,
                    name: sourceNode?.name || edge.source_qualified.split('::').pop() || 'unknown',
                    file_path: sourceNode?.file_path || edge.file_path,
                    line: edge.line,
                    confidence: edge.confidence ?? 1.0,
                });
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
                callerImpact = impacts.length > 0 ? impacts.join('; ') : undefined;
            }

            return {
                qualified_name: node.qualified_name,
                name: node.name,
                kind: node.kind,
                signature,
                file_path: node.file_path,
                line_start: node.line_start,
                line_end: node.line_end,
                callers,
                callees,
                has_test_coverage: testedFiles.has(node.file_path),
                diff_changes: diffChanges,
                contract_diffs: contractDiffs,
                caller_impact: callerImpact,
                is_new: isNew,
                in_flows: flowsByFunction.get(node.qualified_name) || [],
            };
        });
}
