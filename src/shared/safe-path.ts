import { realpathSync } from 'fs';
import { relative, resolve } from 'path';

/**
 * Validate that a resolved path is within the repository root.
 * Returns the validated absolute path.
 * Throws if the path escapes the root.
 */
export function ensureWithinRoot(filePath: string, repoRoot: string): string {
    let absRoot: string;
    try {
        absRoot = realpathSync(resolve(repoRoot));
    } catch {
        absRoot = resolve(repoRoot);
    }

    let absPath: string;
    try {
        absPath = realpathSync(resolve(absRoot, filePath));
    } catch {
        // File doesn't exist yet or is unreadable — use resolve without symlink follow
        absPath = resolve(absRoot, filePath);
    }

    const rel = relative(absRoot, absPath);
    if (rel.startsWith('..') || resolve(absRoot, rel) !== absPath) {
        throw new Error(`Path escapes repository root: ${filePath}`);
    }

    return absPath;
}
