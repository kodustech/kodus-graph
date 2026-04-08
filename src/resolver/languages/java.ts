import { existsSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

const STDLIB_PREFIXES = ['java.', 'javax.', 'sun.', 'com.sun.', 'jdk.'];
const SOURCE_ROOTS = ['src/main/java', 'src/main/kotlin', 'src', ''];

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (STDLIB_PREFIXES.some((p) => modulePath.startsWith(p))) return null;
    if (modulePath.endsWith('.*')) return null;

    const relPath = modulePath.replace(/\./g, '/') + '.java';

    for (const srcRoot of SOURCE_ROOTS) {
        const candidate = join(repoRoot, srcRoot, relPath);
        if (existsSync(candidate)) return resolvePath(candidate);
    }

    return null;
}
