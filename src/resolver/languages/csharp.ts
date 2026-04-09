import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

const STDLIB_PREFIXES = ['System.', 'System', 'Microsoft.', 'Newtonsoft.'];

const slnProjectsCache = new Map<string, string[]>();

/** Clear cached .sln data. Call between analysis runs or when switching repos. */
export function clearCache(): void {
    slnProjectsCache.clear();
}

/**
 * Parse .sln files at repoRoot to discover project directories.
 * Lines like: Project("{FAE04EC0}") = "Name", "path/to/Project.csproj", "{GUID}"
 */
function getSlnProjectDirs(repoRoot: string): string[] {
    const cached = slnProjectsCache.get(repoRoot);
    if (cached) {
        return cached;
    }

    const dirs: string[] = [];

    try {
        const entries = readdirSync(repoRoot);
        for (const entry of entries) {
            if (entry.endsWith('.sln')) {
                const slnPath = join(repoRoot, entry);
                try {
                    const content = readFileSync(slnPath, 'utf-8');
                    const projectRe = /^Project\("[^"]*"\)\s*=\s*"[^"]*",\s*"([^"]+\.csproj)"/gm;
                    let m: RegExpExecArray | null = projectRe.exec(content);
                    while (m !== null) {
                        const csprojRelPath = m[1].replace(/\\/g, '/');
                        const projectDir = dirname(join(repoRoot, csprojRelPath));
                        if (cachedExists(projectDir)) {
                            dirs.push(projectDir);
                        }
                        m = projectRe.exec(content);
                    }
                } catch {
                    /* ignore unreadable sln */
                }
            }
        }
    } catch {
        /* ignore */
    }

    slnProjectsCache.set(repoRoot, dirs);
    return dirs;
}

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (STDLIB_PREFIXES.some((p) => modulePath.startsWith(p))) {
        return null;
    }

    const segments = modulePath.split('.');

    // Collect search base directories: standard ones + .sln-discovered project dirs
    const standardBases = ['', 'src', 'lib', 'Source'];
    const slnDirs = getSlnProjectDirs(repoRoot);

    // Try resolving as a .cs file first
    for (let i = segments.length - 1; i >= 0; i--) {
        const pathPart = segments.slice(i).join('/');
        const candidate = `${pathPart}.cs`;

        for (const base of standardBases) {
            const full = join(repoRoot, base, candidate);
            if (cachedExists(full)) {
                return resolvePath(full);
            }
        }

        // Also search in .sln-discovered project directories
        for (const projDir of slnDirs) {
            const full = join(projDir, candidate);
            if (cachedExists(full)) {
                return resolvePath(full);
            }
        }
    }

    // Try resolving as a directory (namespace → folder mapping)
    for (let i = segments.length - 1; i >= 0; i--) {
        const pathPart = segments.slice(i).join('/');

        for (const base of standardBases) {
            const full = join(repoRoot, base, pathPart);
            if (cachedExists(full) && statSync(full).isDirectory()) {
                return resolvePath(full);
            }
        }

        // Also search in .sln-discovered project directories
        for (const projDir of slnDirs) {
            const full = join(projDir, pathPart);
            if (cachedExists(full) && statSync(full).isDirectory()) {
                return resolvePath(full);
            }
        }
    }

    return null;
}
