/**
 * Kotlin external-package detection.
 *
 * Kotlin-specific stdlib prefixes (`kotlin.`, `kotlinx.`) come first, then
 * the full Java stdlib + Maven/Gradle dependency matching is reused.
 */

import { getOrLoadDeps } from '../external-shared';
import { hasJvmManifest, JAVA_STDLIB_PREFIXES, loadJavaBuildDeps } from '../java/external';

const KOTLIN_STDLIB_PREFIXES = ['kotlin.', 'kotlinx.', ...JAVA_STDLIB_PREFIXES];

export function detect(modulePath: string, repoRoot: string): string | null {
    for (const prefix of KOTLIN_STDLIB_PREFIXES) {
        if (modulePath.startsWith(prefix)) {
            const parts = modulePath.split('.');
            return parts.slice(0, 2).join('.');
        }
    }

    if (!hasJvmManifest(repoRoot)) {
        return null;
    }

    // Kotlin shares the JVM build deps with Java, cached under its own key.
    const deps = getOrLoadDeps('kotlin', repoRoot, () => loadJavaBuildDeps(repoRoot));

    for (const dep of deps.packages) {
        const [groupId, artifactId] = dep.split(':');
        if (modulePath.startsWith(groupId)) {
            return artifactId;
        }
    }

    return null;
}
