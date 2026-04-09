/**
 * Parse unified diff output to extract changed line ranges per file.
 * Used in fallback mode (no DB baseline) to filter which AST functions
 * are truly "changed" vs just "present in the file".
 */

export interface DiffHunk {
    /** First changed line on the new (post-change) side */
    newStart: number;
    /** Number of lines in this hunk on the new side */
    newCount: number;
}

/**
 * Parse a unified diff string into per-file hunk ranges.
 *
 * Accepts standard `git diff` / `git format-patch` output as well as
 * GitHub-style patches (individual file patches concatenated).
 *
 * @returns Map from file path (relative, no leading slash) to its hunks
 */
export function parseDiffHunks(diffContent: string): Map<string, DiffHunk[]> {
    const result = new Map<string, DiffHunk[]>();
    let currentFile: string | null = null;

    for (const line of diffContent.split('\n')) {
        // Match file header: +++ b/path/to/file
        if (line.startsWith('+++ b/')) {
            currentFile = line.slice(6);
            if (!result.has(currentFile)) {
                result.set(currentFile, []);
            }
            continue;
        }

        // Also handle +++ path (without b/ prefix, e.g. GitHub patch format)
        if (line.startsWith('+++ ') && !line.startsWith('+++ /dev/null')) {
            const path = line.slice(4).replace(/^a\/|^b\//, '');
            if (path) {
                currentFile = path;
                if (!result.has(currentFile)) {
                    result.set(currentFile, []);
                }
            }
            continue;
        }

        // Match hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        if (line.startsWith('@@') && currentFile) {
            const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
            if (match) {
                const newStart = parseInt(match[1], 10);
                const newCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
                result.get(currentFile)!.push({ newStart, newCount });
            }
        }
    }

    return result;
}

/**
 * Check if a node's line range overlaps with any diff hunk in the same file.
 *
 * A node [lineStart, lineEnd] overlaps with a hunk [hunkStart, hunkEnd] when:
 *   lineStart <= hunkEnd AND lineEnd >= hunkStart
 */
export function overlapsWithDiff(
    filePath: string,
    lineStart: number,
    lineEnd: number,
    diffHunks: Map<string, DiffHunk[]>,
): boolean {
    const hunks = diffHunks.get(filePath);
    if (!hunks || hunks.length === 0) {
        return false;
    }

    for (const hunk of hunks) {
        // A hunk with newCount=0 means pure deletion at that point — skip
        if (hunk.newCount === 0) {
            continue;
        }

        const hunkEnd = hunk.newStart + hunk.newCount - 1;

        if (lineStart <= hunkEnd && lineEnd >= hunk.newStart) {
            return true;
        }
    }

    return false;
}
