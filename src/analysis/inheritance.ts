import type { IndexedGraph } from '../graph/loader';
import type { InheritanceEntry } from '../graph/types';

export function extractInheritance(graph: IndexedGraph, changedFiles: string[]): InheritanceEntry[] {
    const changedSet = new Set(changedFiles);
    const entries: InheritanceEntry[] = [];

    const changedClasses = graph.nodes.filter((n) => changedSet.has(n.file_path) && n.kind === 'Class');

    for (const cls of changedClasses) {
        let extendsClass: string | undefined;
        const implementsList: string[] = [];
        const children: string[] = [];

        for (const edge of graph.adjacency.get(cls.qualified_name) || []) {
            if (edge.kind === 'INHERITS') {
                extendsClass = edge.target_qualified;
            }
            if (edge.kind === 'IMPLEMENTS') {
                implementsList.push(edge.target_qualified);
            }
        }

        for (const edge of graph.reverseAdjacency.get(cls.qualified_name) || []) {
            if (edge.kind === 'INHERITS') {
                children.push(edge.source_qualified);
            }
        }

        entries.push({
            qualified_name: cls.qualified_name,
            file_path: cls.file_path,
            extends: extendsClass,
            implements: implementsList,
            children,
        });
    }

    return entries;
}
