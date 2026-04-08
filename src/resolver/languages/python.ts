/**
 * Python import resolver.
 *
 * Handles dotted module paths (e.g., "from x.y import z").
 * Walks up directories to find packages.
 */

import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

/**
 * Resolve a Python dotted import to a file path.
 * Walks up from the importing file's directory to find the module.
 */
export function resolve(fromAbsFile: string, modulePath: string, _repoRoot: string): string | null {
    if (!modulePath) {
        return null;
    }

    if (modulePath.startsWith('.')) {
        // Relative import: count leading dots, walk up directories
        const dotMatch = modulePath.match(/^(\.+)/);
        const dots = dotMatch![1].length;
        const rest = modulePath.slice(dots).replace(/\./g, '/');

        let base = dirname(fromAbsFile);
        for (let d = 1; d < dots; d++) {
            base = dirname(base);
        }

        const candidates = rest ? [`${rest}.py`, `${rest}/__init__.py`] : [`__init__.py`];

        for (const candidate of candidates) {
            const full = join(base, candidate);
            if (cachedExists(full)) {
                return resolvePath(full);
            }
        }

        return null;
    }

    const parts = modulePath.replace(/\./g, '/');
    let current = dirname(fromAbsFile);

    for (let i = 0; i < 10; i++) {
        for (const candidate of [`${parts}.py`, `${parts}/__init__.py`]) {
            const full = join(current, candidate);
            if (cachedExists(full)) {
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
