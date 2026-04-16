import { readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { cachedExists, cachedReaddir } from '../../resolver/fs-cache';

const STDLIB_PREFIXES = [
    'java.',
    'javax.',
    'sun.',
    'com.sun.',
    'jdk.',
    'kotlin.',
    'kotlinx.',
    'scala.',
    'akka.',
    'play.',
];
const SOURCE_ROOTS = ['src/main/java', 'src/main/kotlin', 'src/main/scala', 'src', ''];
const EXTENSIONS = ['.java', '.kt', '.scala'];

/**
 * Collect all source roots, including those inside Gradle subproject directories.
 */
function collectSourceRoots(repoRoot: string): string[] {
    const roots: string[] = [...SOURCE_ROOTS];

    // Discover Gradle subprojects from settings.gradle / settings.gradle.kts
    for (const settingsFile of ['settings.gradle', 'settings.gradle.kts']) {
        const settingsPath = join(repoRoot, settingsFile);
        if (!cachedExists(settingsPath)) {
            continue;
        }

        const content = readFileSync(settingsPath, 'utf-8');
        // Match patterns like ':app', ':lib', ':core:domain'
        const projectRegex = /['"]:([\w:/-]+)['"]/g;
        let match: RegExpExecArray | null = projectRegex.exec(content);
        while (match !== null) {
            const subDir = match[1].replace(/:/g, '/');
            for (const srcRoot of SOURCE_ROOTS) {
                if (srcRoot) {
                    roots.push(join(subDir, srcRoot));
                }
            }
            match = projectRegex.exec(content);
        }
        break; // only read first settings file found
    }

    // Discover custom sourceSets from build.gradle / build.gradle.kts in subprojects
    const gradleFiles: { dir: string; file: string }[] = [];

    // Collect build.gradle files: root + discovered subproject dirs
    for (const buildFile of ['build.gradle', 'build.gradle.kts']) {
        if (cachedExists(join(repoRoot, buildFile))) {
            gradleFiles.push({ dir: '', file: buildFile });
        }
    }

    // Also check subproject directories already discovered above
    const subDirs = new Set<string>();
    for (const r of roots) {
        // Extract the subproject directory (everything before src/...)
        const srcIdx = r.indexOf('/src');
        if (srcIdx > 0) {
            subDirs.add(r.slice(0, srcIdx));
        }
    }
    for (const sub of subDirs) {
        for (const buildFile of ['build.gradle', 'build.gradle.kts']) {
            const buildPath = join(repoRoot, sub, buildFile);
            if (cachedExists(buildPath)) {
                gradleFiles.push({ dir: sub, file: join(sub, buildFile) });
            }
        }
    }

    for (const { dir, file } of gradleFiles) {
        try {
            const content = readFileSync(join(repoRoot, file), 'utf-8');

            // Match: srcDirs = ['path1', 'path2']
            const srcDirsArrayRegex = /srcDirs\s*=\s*\[([^\]]+)\]/g;
            let sdMatch: RegExpExecArray | null = srcDirsArrayRegex.exec(content);
            while (sdMatch !== null) {
                const entries = sdMatch[1];
                const pathRegex = /['"]([^'"]+)['"]/g;
                let pathMatch: RegExpExecArray | null = pathRegex.exec(entries);
                while (pathMatch !== null) {
                    const srcDir = pathMatch[1];
                    const root = dir ? join(dir, srcDir) : srcDir;
                    if (!roots.includes(root)) {
                        roots.push(root);
                    }
                    pathMatch = pathRegex.exec(entries);
                }
                sdMatch = srcDirsArrayRegex.exec(content);
            }

            // Match: srcDir 'path' or srcDir "path"
            const srcDirSingleRegex = /srcDir\s+['"]([^'"]+)['"]/g;
            let singleMatch: RegExpExecArray | null = srcDirSingleRegex.exec(content);
            while (singleMatch !== null) {
                const srcDir = singleMatch[1];
                const root = dir ? join(dir, srcDir) : srcDir;
                if (!roots.includes(root)) {
                    roots.push(root);
                }
                singleMatch = srcDirSingleRegex.exec(content);
            }
        } catch {
            // build.gradle read failed, continue
        }
    }

    // Discover Maven subprojects from pom.xml (recursive)
    discoverMavenModules(repoRoot, '', roots, 0);

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
            if (cachedExists(candidate)) {
                return resolvePath(candidate);
            }
        }
    }
    return null;
}

const MAX_MAVEN_DEPTH = 5;

/**
 * Recursively discover Maven modules from pom.xml files.
 * Each module's pom.xml may declare its own <module> elements,
 * forming a tree (e.g. Keycloak: root → services → sub-service).
 */
function discoverMavenModules(repoRoot: string, relDir: string, roots: string[], depth: number): void {
    if (depth > MAX_MAVEN_DEPTH) {
        return;
    }

    const pomPath = join(repoRoot, relDir, 'pom.xml');
    if (!cachedExists(pomPath)) {
        return;
    }

    try {
        const content = readFileSync(pomPath, 'utf-8');
        const moduleRegex = /<module>([^<]+)<\/module>/g;
        let mvnMatch: RegExpExecArray | null = moduleRegex.exec(content);
        while (mvnMatch !== null) {
            const moduleName = mvnMatch[1];
            const moduleDir = relDir ? join(relDir, moduleName) : moduleName;

            // Add source roots for this module
            const javaRoot = join(moduleDir, 'src/main/java');
            if (!roots.includes(javaRoot)) {
                roots.push(javaRoot);
            }
            const kotlinRoot = join(moduleDir, 'src/main/kotlin');
            if (!roots.includes(kotlinRoot)) {
                roots.push(kotlinRoot);
            }

            // Recurse into the module's own pom.xml
            discoverMavenModules(repoRoot, moduleDir, roots, depth + 1);

            mvnMatch = moduleRegex.exec(content);
        }
    } catch {
        // pom.xml read failed, continue
    }
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
            if (cachedExists(dirPath)) {
                try {
                    const files = cachedReaddir(dirPath).filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)));
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
    if (direct) {
        return direct;
    }

    // --- Inner class fallback: progressively shorten the path ---
    // com.example.Config.DatabaseSettings → try com/example/Config
    const segments = modulePath.split('.');
    for (let i = segments.length - 1; i >= 2; i--) {
        const shorter = segments.slice(0, i).join('/');
        const found = findFile(repoRoot, shorter, sourceRoots);
        if (found) {
            return found;
        }
    }

    return null;
}
