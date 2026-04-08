import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

const moduleCache = new Map<string, string>();

function getModuleName(repoRoot: string): string | null {
    const cached = moduleCache.get(repoRoot);
    if (cached !== undefined) return cached || null;

    const goModPath = join(repoRoot, 'go.mod');
    if (!existsSync(goModPath)) {
        moduleCache.set(repoRoot, '');
        return null;
    }

    try {
        const content = readFileSync(goModPath, 'utf-8');
        const match = content.match(/^module\s+(\S+)/m);
        if (match) {
            moduleCache.set(repoRoot, match[1]);
            return match[1];
        }
    } catch { /* ignore */ }

    moduleCache.set(repoRoot, '');
    return null;
}

function isStdlib(modulePath: string): boolean {
    const first = modulePath.split('/')[0];
    return !first.includes('.');
}

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (isStdlib(modulePath)) return null;

    const moduleName = getModuleName(repoRoot);
    if (!moduleName) return null;
    if (!modulePath.startsWith(moduleName)) return null;

    const relPath = modulePath.slice(moduleName.length + 1);
    if (!relPath) return null;

    const absDir = join(repoRoot, relPath);

    if (existsSync(absDir)) {
        try {
            const files = readdirSync(absDir);
            const goFile = files.find((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
            if (goFile) return resolvePath(join(absDir, goFile));
        } catch { /* not a directory */ }
    }

    if (existsSync(absDir + '.go')) return resolvePath(absDir + '.go');

    return null;
}
