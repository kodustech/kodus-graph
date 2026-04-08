import { existsSync, readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

const psr4Cache = new Map<string, Map<string, string>>();

/** Clear cached composer.json PSR-4 data. Call between analysis runs or when switching repos. */
export function clearCache(): void {
    psr4Cache.clear();
}

function loadPsr4(repoRoot: string): Map<string, string> {
    const cached = psr4Cache.get(repoRoot);
    if (cached) {
        return cached;
    }

    const map = new Map<string, string>();
    const composerPath = join(repoRoot, 'composer.json');

    if (existsSync(composerPath)) {
        try {
            const content = readFileSync(composerPath, 'utf-8');
            const config = JSON.parse(content);
            const psr4 = config?.autoload?.['psr-4'];
            if (psr4) {
                for (const [prefix, dir] of Object.entries(psr4)) {
                    const dirStr = Array.isArray(dir) ? dir[0] : dir;
                    map.set(prefix as string, dirStr as string);
                }
            }
        } catch {
            /* ignore */
        }
    }

    psr4Cache.set(repoRoot, map);
    return map;
}

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    const psr4 = loadPsr4(repoRoot);

    for (const [prefix, dir] of psr4) {
        if (modulePath.startsWith(prefix)) {
            const rest = modulePath.slice(prefix.length);
            const relPath = `${rest.replace(/\\/g, '/')}.php`;
            const candidate = join(repoRoot, dir, relPath);
            if (existsSync(candidate)) {
                return resolvePath(candidate);
            }
        }
    }

    const relPath = `${modulePath.replace(/\\/g, '/')}.php`;
    for (const base of ['', 'src', 'lib', 'app']) {
        const candidate = join(repoRoot, base, relPath);
        if (existsSync(candidate)) {
            return resolvePath(candidate);
        }
    }

    return null;
}
