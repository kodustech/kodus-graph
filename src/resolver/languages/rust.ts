import { existsSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';

function probeRustPath(baseDir: string, relPath: string): string | null {
    const asFile = join(baseDir, relPath + '.rs');
    if (existsSync(asFile)) return resolvePath(asFile);

    const asMod = join(baseDir, relPath, 'mod.rs');
    if (existsSync(asMod)) return resolvePath(asMod);

    const asLib = join(baseDir, relPath, 'lib.rs');
    if (existsSync(asLib)) return resolvePath(asLib);

    return null;
}

export function resolve(fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (modulePath.startsWith('std::')) return null;

    if (modulePath.startsWith('crate::')) {
        const rest = modulePath.slice('crate::'.length).replace(/::/g, '/');
        return probeRustPath(join(repoRoot, 'src'), rest);
    }

    if (modulePath.startsWith('super::')) {
        const rest = modulePath.slice('super::'.length).replace(/::/g, '/');
        return probeRustPath(dirname(dirname(fromAbsFile)), rest);
    }

    if (modulePath.startsWith('self::')) {
        const rest = modulePath.slice('self::'.length).replace(/::/g, '/');
        return probeRustPath(dirname(fromAbsFile), rest);
    }

    return null;
}
