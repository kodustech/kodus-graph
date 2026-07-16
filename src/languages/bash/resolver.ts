/**
 * Bash import resolver.
 *
 * `source path` / `. path` reference a file directly — there is no package
 * system. Paths are resolved relative to the sourcing file first (the common
 * case), then relative to the repo root, trying the bare path and the `.sh` /
 * `.bash` extensions. Shell variables in a path (`source "$DIR/lib.sh"`) cannot
 * be resolved statically and return null.
 */

import { dirname, isAbsolute, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../../resolver/fs-cache';

const CANDIDATE_EXTS = ['', '.sh', '.bash'];

function firstExisting(base: string): string | null {
    for (const ext of CANDIDATE_EXTS) {
        const candidate = `${base}${ext}`;
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }
    return null;
}

export function resolve(fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (!modulePath || modulePath.includes('$')) {
        return null;
    }

    if (isAbsolute(modulePath)) {
        return firstExisting(modulePath);
    }

    // 1. Relative to the sourcing file's directory.
    const relative = firstExisting(join(dirname(fromAbsFile), modulePath));
    if (relative) {
        return relative;
    }

    // 2. Relative to the repo root.
    return firstExisting(join(repoRoot, modulePath));
}
