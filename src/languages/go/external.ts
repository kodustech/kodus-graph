/**
 * Go external-package detection.
 *
 * The first segment of a Go import path is treated as stdlib when it has
 * no dot. Anything with a dot is matched against the repo's own module
 * (go.mod) and against the require list.
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

function loadDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const meta: Record<string, string> = {};
    const gomod = safeRead(join(repoRoot, 'go.mod'));
    if (gomod) {
        // Extract module name
        const modMatch = gomod.match(/^module\s+(.+)$/m);
        if (modMatch) {
            meta.module = modMatch[1].trim();
        }
        // Extract require block
        let inRequire = false;
        for (const line of gomod.split('\n')) {
            const trimmed = line.trim();
            if (trimmed === 'require (') {
                inRequire = true;
                continue;
            }
            if (trimmed === ')') {
                inRequire = false;
                continue;
            }
            if (inRequire) {
                const match = trimmed.match(/^(\S+)\s+/);
                if (match) {
                    pkgs.add(match[1]);
                }
            }
            // Single-line require
            const singleMatch = trimmed.match(/^require\s+(\S+)\s+/);
            if (singleMatch) {
                pkgs.add(singleMatch[1]);
            }
        }
    }
    return { packages: pkgs, meta };
}

export function detect(modulePath: string, repoRoot: string): string | null {
    // Go stdlib: no dot in first segment
    const firstSegment = modulePath.split('/')[0];
    if (!firstSegment.includes('.')) {
        return modulePath;
    }

    if (!cachedExists(join(repoRoot, 'go.mod'))) {
        return null;
    }

    const deps = getOrLoadDeps('go', repoRoot, () => loadDeps(repoRoot));

    // Check if it's the project's own module
    const ownModule = deps.meta?.module;
    if (ownModule && modulePath.startsWith(ownModule)) {
        return null;
    }

    // Check require list — match prefix
    for (const dep of deps.packages) {
        if (modulePath === dep || modulePath.startsWith(`${dep}/`)) {
            return dep;
        }
    }

    // Has a dot in first segment but not in require list — still likely external
    return modulePath;
}
