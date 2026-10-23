import type { GraphNode } from '../graph/types';

/**
 * Build the check both formatters use to flag an import `unresolved`.
 *
 * Only an import whose target file WAS parsed (has ≥ 1 node) yet declares no
 * matching symbol is unresolved — a genuine barrel-follow or dead import. A
 * target file that wasn't parsed (outside the changed-file slice, or no
 * baseline seeded) is a real repo dependency whose symbols we can't see, not a
 * broken import. Without this gate a slice with no baseline marks nearly every
 * cross-file import unresolved (observed on a real Keycloak multi-module PR:
 * 21 false "unresolved" out of ~26 imports).
 */
export function unresolvedImportCheck(nodes: GraphNode[]): (targetQualified: string) => boolean {
    const allNodes = new Set(nodes.map((n) => n.qualified_name));
    const parsedFiles = new Set(nodes.map((n) => n.file_path));
    // Every `::`-prefix of a node QN: a target that is one declares something.
    const declaringPrefixes = new Set<string>();
    for (const qn of allNodes) {
        for (let i = qn.indexOf('::'); i > 0; i = qn.indexOf('::', i + 2)) {
            declaringPrefixes.add(qn.slice(0, i));
        }
    }

    return (targetQualified) => {
        const targetFile = targetQualified.includes('::') ? targetQualified.split('::')[0] : targetQualified;
        if (!parsedFiles.has(targetFile)) {
            return false; // file not in this graph — unknown, don't flag
        }
        return !allNodes.has(targetQualified) && !declaringPrefixes.has(targetQualified);
    };
}
