import { statSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

const STDLIB_PREFIXES = ['System.', 'System', 'Microsoft.', 'Newtonsoft.'];

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (STDLIB_PREFIXES.some((p) => modulePath.startsWith(p))) {
        return null;
    }

    const segments = modulePath.split('.');

    // Try resolving as a .cs file first
    for (let i = segments.length - 1; i >= 0; i--) {
        const pathPart = segments.slice(i).join('/');
        const candidate = `${pathPart}.cs`;

        for (const base of ['', 'src', 'lib', 'Source']) {
            const full = join(repoRoot, base, candidate);
            if (cachedExists(full)) {
                return resolvePath(full);
            }
        }
    }

    // Try resolving as a directory (namespace → folder mapping)
    for (let i = segments.length - 1; i >= 0; i--) {
        const pathPart = segments.slice(i).join('/');

        for (const base of ['', 'src', 'lib', 'Source']) {
            const full = join(repoRoot, base, pathPart);
            if (cachedExists(full) && statSync(full).isDirectory()) {
                return resolvePath(full);
            }
        }
    }

    return null;
}
