import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

const STDLIB_PREFIXES = ['java.', 'javax.', 'sun.', 'com.sun.', 'jdk.'];
const SOURCE_ROOTS = ['src/main/java', 'src/main/kotlin', 'src', ''];
const EXTENSIONS = ['.java', '.kt'];

/**
 * Collect all source roots, including those inside Gradle subproject directories.
 */
function collectSourceRoots(repoRoot: string): string[] {
    const roots: string[] = [...SOURCE_ROOTS];

    // Discover Gradle subprojects from settings.gradle / settings.gradle.kts
    for (const settingsFile of ['settings.gradle', 'settings.gradle.kts']) {
        const settingsPath = join(repoRoot, settingsFile);
        if (!existsSync(settingsPath)) continue;

        const content = readFileSync(settingsPath, 'utf-8');
        // Match patterns like ':app', ':lib', ':core:domain'
        const projectRegex = /['"]:([\w:/-]+)['"]/g;
        let match: RegExpExecArray | null;
        while ((match = projectRegex.exec(content)) !== null) {
            const subDir = match[1].replace(/:/g, '/');
            for (const srcRoot of SOURCE_ROOTS) {
                if (srcRoot) {
                    roots.push(join(subDir, srcRoot));
                }
            }
        }
        break; // only read first settings file found
    }

    // Discover Maven subprojects from pom.xml
    const pomPath = join(repoRoot, 'pom.xml');
    if (existsSync(pomPath)) {
        try {
            const content = readFileSync(pomPath, 'utf-8');
            const moduleRegex = /<module>([^<]+)<\/module>/g;
            let match: RegExpExecArray | null;
            while ((match = moduleRegex.exec(content)) !== null) {
                const subDir = match[1];
                roots.push(join(subDir, 'src/main/java'));
                roots.push(join(subDir, 'src/main/kotlin'));
            }
        } catch {
            // pom.xml read failed, continue
        }
    }

    return roots;
}

/**
 * Try to find a file at the given relative path (without extension) across all
 * source roots, probing each supported extension.
 */
function findFile(repoRoot: string, relPathNoExt: string, sourceRoots: string[]): string | null {
    for (const srcRoot of sourceRoots) {
        for (const ext of EXTENSIONS) {
            const candidate = join(repoRoot, srcRoot, relPathNoExt + ext);
            if (existsSync(candidate)) return resolvePath(candidate);
        }
    }
    return null;
}

export function resolve(_fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (STDLIB_PREFIXES.some((p) => modulePath.startsWith(p))) {
        return null;
    }

    const sourceRoots = collectSourceRoots(repoRoot);

    // --- Wildcard imports: com.example.models.* ---
    if (modulePath.endsWith('.*')) {
        const packagePath = modulePath.slice(0, -2).replace(/\./g, '/');
        for (const srcRoot of sourceRoots) {
            const dirPath = join(repoRoot, srcRoot, packagePath);
            if (existsSync(dirPath)) {
                try {
                    const files = readdirSync(dirPath).filter(
                        (f) => EXTENSIONS.some((ext) => f.endsWith(ext)),
                    );
                    if (files.length > 0) {
                        return resolvePath(join(dirPath, files[0]));
                    }
                } catch {
                    // directory read failed, try next root
                }
            }
        }
        return null;
    }

    // --- Standard resolution: try full path with all extensions ---
    const relPathNoExt = modulePath.replace(/\./g, '/');
    const direct = findFile(repoRoot, relPathNoExt, sourceRoots);
    if (direct) return direct;

    // --- Inner class fallback: progressively shorten the path ---
    // com.example.Config.DatabaseSettings → try com/example/Config
    const segments = modulePath.split('.');
    for (let i = segments.length - 1; i >= 2; i--) {
        const shorter = segments.slice(0, i).join('/');
        const found = findFile(repoRoot, shorter, sourceRoots);
        if (found) return found;
    }

    return null;
}
