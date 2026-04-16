/**
 * Scala external-package detection.
 *
 * Scala-specific prefixes (`scala.`, `akka.`, `play.`) come first, then
 * the full Java stdlib + Maven/Gradle/SBT dependency matching is reused.
 */

import { getOrLoadDeps } from '../external-shared';
import { hasJvmManifest, JAVA_STDLIB_PREFIXES, loadJavaBuildDeps } from '../java/external';

const SCALA_STDLIB_PREFIXES = ['scala.', 'akka.', 'play.', ...JAVA_STDLIB_PREFIXES];

export function detect(modulePath: string, repoRoot: string): string | null {
    for (const prefix of SCALA_STDLIB_PREFIXES) {
        if (modulePath.startsWith(prefix)) {
            const parts = modulePath.split('.');
            return parts.slice(0, 2).join('.');
        }
    }

    if (!hasJvmManifest(repoRoot)) {
        return null;
    }

    const deps = getOrLoadDeps('scala', repoRoot, () => loadJavaBuildDeps(repoRoot));

    for (const dep of deps.packages) {
        const [groupId, artifactId] = dep.split(':');
        if (modulePath.startsWith(groupId)) {
            return artifactId;
        }
    }

    return null;
}
