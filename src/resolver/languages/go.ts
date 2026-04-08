import { readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { cachedExists, cachedReaddir } from '../fs-cache';

const moduleCache = new Map<string, string>();
const replaceCache = new Map<string, Map<string, string>>();
const workspaceCache = new Map<string, Map<string, string>>();

/** Clear cached go.mod data. Call between analysis runs or when switching repos. */
export function clearCache(): void {
    moduleCache.clear();
    replaceCache.clear();
    workspaceCache.clear();
}

function getModuleName(repoRoot: string): string | null {
    const cached = moduleCache.get(repoRoot);
    if (cached !== undefined) {
        return cached || null;
    }

    const goModPath = join(repoRoot, 'go.mod');
    if (!cachedExists(goModPath)) {
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
    } catch {
        /* ignore */
    }

    moduleCache.set(repoRoot, '');
    return null;
}

/** Parse replace directives from go.mod. Returns map: module path → local directory (absolute). */
function getReplaceMap(repoRoot: string): Map<string, string> {
    const cached = replaceCache.get(repoRoot);
    if (cached) {
        return cached;
    }

    const result = new Map<string, string>();
    const goModPath = join(repoRoot, 'go.mod');
    if (!cachedExists(goModPath)) {
        replaceCache.set(repoRoot, result);
        return result;
    }

    try {
        const content = readFileSync(goModPath, 'utf-8');
        // Match single-line replace: replace mod => ./path  or  replace mod v1.2.3 => ./path
        const replaceRe = /^replace\s+(\S+)(?:\s+\S+)?\s+=>\s+(\S+)/gm;
        let m: RegExpExecArray | null = replaceRe.exec(content);
        while (m !== null) {
            const modPath = m[1];
            const replacement = m[2];
            if (replacement.startsWith('./') || replacement.startsWith('../')) {
                result.set(modPath, resolvePath(join(repoRoot, replacement)));
            }
            m = replaceRe.exec(content);
        }
    } catch {
        /* ignore */
    }

    replaceCache.set(repoRoot, result);
    return result;
}

/** Parse go.work use directives. Returns map: module name → absolute directory of the module. */
function getWorkspaceModules(repoRoot: string): Map<string, string> {
    const cached = workspaceCache.get(repoRoot);
    if (cached) {
        return cached;
    }

    const result = new Map<string, string>();
    const goWorkPath = join(repoRoot, 'go.work');
    if (!cachedExists(goWorkPath)) {
        workspaceCache.set(repoRoot, result);
        return result;
    }

    try {
        const content = readFileSync(goWorkPath, 'utf-8');
        // Parse use directives — both single-line and block form
        // Block: use ( ./a \n ./b )
        const blockRe = /use\s*\(([\s\S]*?)\)/g;
        let blockMatch: RegExpExecArray | null = blockRe.exec(content);
        const useDirs: string[] = [];

        while (blockMatch !== null) {
            const inner = blockMatch[1];
            for (const line of inner.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('//')) {
                    useDirs.push(trimmed);
                }
            }
            blockMatch = blockRe.exec(content);
        }

        // Single-line: use ./foo
        const singleRe = /^use\s+(\S+)\s*$/gm;
        let singleMatch: RegExpExecArray | null = singleRe.exec(content);
        while (singleMatch !== null) {
            const dir = singleMatch[1];
            if (dir !== '(') {
                useDirs.push(dir);
            }
            singleMatch = singleRe.exec(content);
        }

        // For each use directory, read its go.mod to get the module name
        for (const dir of useDirs) {
            const absDir = resolvePath(join(repoRoot, dir));
            const modName = getModuleName(absDir);
            if (modName) {
                result.set(modName, absDir);
            }
        }
    } catch {
        /* ignore */
    }

    workspaceCache.set(repoRoot, result);
    return result;
}

function isStdlib(modulePath: string): boolean {
    const first = modulePath.split('/')[0];
    return !first.includes('.');
}

/** Find the first .go file (non-test) in a directory, or check for a .go file at the path. */
function findGoFile(absDir: string): string | null {
    if (cachedExists(absDir)) {
        try {
            const files = cachedReaddir(absDir).sort();
            const goFile = files.find((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
            if (goFile) {
                return resolvePath(join(absDir, goFile));
            }
        } catch {
            /* not a directory */
        }
    }

    if (cachedExists(`${absDir}.go`)) {
        return resolvePath(`${absDir}.go`);
    }

    return null;
}

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (isStdlib(modulePath)) {
        return null;
    }

    // 1. Try resolving against the root module name
    const moduleName = getModuleName(repoRoot);
    if (moduleName && modulePath.startsWith(moduleName)) {
        const relPath = modulePath.slice(moduleName.length + 1);
        if (relPath) {
            const result = findGoFile(join(repoRoot, relPath));
            if (result) {
                return result;
            }
        }
    }

    // 2. Try replace directives from go.mod
    const replaces = getReplaceMap(repoRoot);
    for (const [modPrefix, localDir] of replaces) {
        if (modulePath.startsWith(modPrefix)) {
            const suffix = modulePath.slice(modPrefix.length);
            // suffix is either empty or starts with '/'
            const relPath = suffix.startsWith('/') ? suffix.slice(1) : suffix;
            if (relPath) {
                const result = findGoFile(join(localDir, relPath));
                if (result) {
                    return result;
                }
            }
        }
    }

    // 3. Try go.work workspace modules
    const workspaceModules = getWorkspaceModules(repoRoot);
    for (const [wsModName, wsModDir] of workspaceModules) {
        if (modulePath.startsWith(wsModName)) {
            const suffix = modulePath.slice(wsModName.length);
            const relPath = suffix.startsWith('/') ? suffix.slice(1) : suffix;
            if (relPath) {
                const result = findGoFile(join(wsModDir, relPath));
                if (result) {
                    return result;
                }
            }
        }
    }

    // 4. Try vendor directory
    const vendorDir = join(repoRoot, 'vendor', modulePath);
    const vendorResult = findGoFile(vendorDir);
    if (vendorResult) {
        return vendorResult;
    }

    return null;
}
