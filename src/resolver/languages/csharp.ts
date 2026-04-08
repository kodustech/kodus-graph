import { existsSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

const STDLIB_PREFIXES = ['System.', 'System', 'Microsoft.', 'Newtonsoft.'];

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (STDLIB_PREFIXES.some((p) => modulePath.startsWith(p))) return null;

    const segments = modulePath.split('.');

    for (let i = segments.length - 1; i >= 0; i--) {
        const pathPart = segments.slice(i).join('/');
        const candidate = pathPart + '.cs';

        for (const base of ['', 'src', 'lib', 'Source']) {
            const full = join(repoRoot, base, candidate);
            if (existsSync(full)) return resolvePath(full);
        }
    }

    return null;
}
