import { join, resolve as resolvePath } from 'path';
import { cachedExists, cachedReaddir, cachedReadFile, registerCacheClear } from '../../resolver/fs-cache';

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
// Default source roots probed at the repo root. Every Maven/Gradle module
// also gets these — `src/main/{java,kotlin,scala}` for production code and
// `src/test/{java,kotlin,scala}` so test files can resolve cross-module
// references (added 2026-04-30 for #74).
const SOURCE_ROOTS = [
    'src/main/java',
    'src/main/kotlin',
    'src/main/scala',
    'src/test/java',
    'src/test/kotlin',
    'src/test/scala',
    'src',
    '',
];
const MODULE_SUB_ROOTS = [
    'src/main/java',
    'src/main/kotlin',
    'src/main/scala',
    'src/test/java',
    'src/test/kotlin',
    'src/test/scala',
];
const EXTENSIONS = ['.java', '.kt', '.scala'];

// Per-repo memoization of source-root discovery — collectSourceRoots otherwise
// re-parses every pom.xml on every import resolution call (thousands of hits
// for keycloak-scale repos). Cleared by `clearFsCache`.
const sourceRootsCache = new Map<string, string[]>();
registerCacheClear(() => sourceRootsCache.clear());

/**
 * Collect all source roots, including those inside Gradle/Maven subproject
 * directories. Result is cached per repoRoot — keycloak-scale repos otherwise
 * pay the discovery cost on every import resolution call.
 */
function collectSourceRoots(repoRoot: string): string[] {
    const cached = sourceRootsCache.get(repoRoot);
    if (cached) {
        return cached;
    }

    const roots: string[] = [...SOURCE_ROOTS];

    // Discover Gradle subprojects from settings.gradle / settings.gradle.kts
    for (const settingsFile of ['settings.gradle', 'settings.gradle.kts']) {
        const settingsPath = join(repoRoot, settingsFile);
        if (!cachedExists(settingsPath)) {
            continue;
        }

        const content = cachedReadFile(settingsPath);
        if (content === null) {
            continue;
        }
        // Match patterns like ':app', ':lib', ':core:domain'
        const projectRegex = /['"]:([\w:/-]+)['"]/g;
        let match: RegExpExecArray | null = projectRegex.exec(content);
        while (match !== null) {
            const subDir = match[1].replace(/:/g, '/');
            for (const srcRoot of MODULE_SUB_ROOTS) {
                roots.push(join(subDir, srcRoot));
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
        const content = cachedReadFile(join(repoRoot, file));
        if (content === null) {
            continue;
        }

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
    }

    // Discover Maven subprojects from pom.xml (recursive)
    discoverMavenModules(repoRoot, '', roots, 0);

    sourceRootsCache.set(repoRoot, roots);
    return roots;
}

/** Test-only — clears memoized source roots so repeated tests in one process see fresh state. */
export function _clearSourceRootsCache(): void {
    sourceRootsCache.clear();
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
 *
 * Also discovers `<sourceDirectory>` and `<testSourceDirectory>` overrides
 * declared in `<build>` blocks (uncommon but present in legacy projects).
 */
function discoverMavenModules(repoRoot: string, relDir: string, roots: string[], depth: number): void {
    if (depth > MAX_MAVEN_DEPTH) {
        return;
    }

    const pomPath = join(repoRoot, relDir, 'pom.xml');
    if (!cachedExists(pomPath)) {
        return;
    }

    const content = cachedReadFile(pomPath);
    if (content === null) {
        return;
    }

    // Custom <sourceDirectory>/<testSourceDirectory> in this pom's <build> block.
    const customDirRegex =
        /<(?:sourceDirectory|testSourceDirectory)>([^<]+)<\/(?:sourceDirectory|testSourceDirectory)>/g;
    let customMatch: RegExpExecArray | null = customDirRegex.exec(content);
    while (customMatch !== null) {
        const raw = customMatch[1].trim();
        // Strip leading ${project.basedir}/ or ${basedir}/ — common in legacy poms.
        const cleaned = raw.replace(/^\$\{[^}]+\}\/?/, '');
        if (cleaned && !cleaned.includes('${')) {
            const root = relDir ? join(relDir, cleaned) : cleaned;
            if (!roots.includes(root)) {
                roots.push(root);
            }
        }
        customMatch = customDirRegex.exec(content);
    }

    const moduleRegex = /<module>([^<]+)<\/module>/g;
    let mvnMatch: RegExpExecArray | null = moduleRegex.exec(content);
    while (mvnMatch !== null) {
        const moduleName = mvnMatch[1].trim();
        const moduleDir = relDir ? join(relDir, moduleName) : moduleName;

        // Add main + test source roots for this module — keycloak-style repos
        // mix prod and test references across modules; without test roots,
        // imports from test files fall through to "unresolved".
        for (const sub of MODULE_SUB_ROOTS) {
            const root = join(moduleDir, sub);
            if (!roots.includes(root)) {
                roots.push(root);
            }
        }

        // Recurse into the module's own pom.xml
        discoverMavenModules(repoRoot, moduleDir, roots, depth + 1);

        mvnMatch = moduleRegex.exec(content);
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
