/**
 * Python import resolver.
 *
 * Handles dotted module paths (e.g., "from x.y import z").
 * Walks up directories to find packages.
 */

import { existsSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';

/**
 * Resolve a Python dotted import to a file path.
 * Walks up from the importing file's directory to find the module.
 */
export function resolve(fromAbsFile: string, modulePath: string, _repoRoot: string): string | null {
    if (!modulePath || modulePath.startsWith('.')) {
        // Relative import -- not handled yet
        return null;
    }

    const parts = modulePath.replace(/\./g, '/');
    let current = dirname(fromAbsFile);

    for (let i = 0; i < 10; i++) {
        for (const candidate of [`${parts}.py`, `${parts}/__init__.py`]) {
            const full = join(current, candidate);
            if (existsSync(full)) {
                return resolvePath(full);
            }
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return null;
}
