/**
 * Java external-package detection.
 *
 * Java stdlib prefixes (java., javax., jakarta., sun., com.sun., jdk.) are
 * detected first. Remaining imports are matched against Maven / Gradle
 * dependencies stored as `groupId:artifactId` (see loadJavaBuildDeps).
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

export const JAVA_STDLIB_PREFIXES = ['java.', 'javax.', 'jakarta.', 'sun.', 'com.sun.', 'jdk.'];

/**
 * Parse Maven (pom.xml) and Gradle (build.gradle / build.gradle.kts) files
 * and return dependency identifiers in `groupId:artifactId` form.
 *
 * Shared with Kotlin and Scala: all three live on the JVM and typically
 * use the same build tooling.
 */
export function loadJavaBuildDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();

    // pom.xml — simple regex-based parsing
    const pom = safeRead(join(repoRoot, 'pom.xml'));
    if (pom) {
        const depRegex = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/gs;
        let m: RegExpExecArray | null = depRegex.exec(pom);
        while (m !== null) {
            pkgs.add(`${m[1]}:${m[2]}`);
            m = depRegex.exec(pom);
        }
    }

    // build.gradle / build.gradle.kts — basic regex
    const gradle = safeRead(join(repoRoot, 'build.gradle'));
    const gradleKts = safeRead(join(repoRoot, 'build.gradle.kts'));
    for (const text of [gradle, gradleKts]) {
        if (!text) {
            continue;
        }
        // Matches: implementation 'group:artifact:version' or "group:artifact:version"
        const regex = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s+['"]([^'"]+)['"]/g;
        let gm: RegExpExecArray | null = regex.exec(text);
        while (gm !== null) {
            const parts = gm[1].split(':');
            if (parts.length >= 2) {
                pkgs.add(`${parts[0]}:${parts[1]}`);
            }
            gm = regex.exec(text);
        }
    }

    return { packages: pkgs };
}

export function hasJvmManifest(repoRoot: string): boolean {
    return (
        cachedExists(join(repoRoot, 'pom.xml')) ||
        cachedExists(join(repoRoot, 'build.gradle')) ||
        cachedExists(join(repoRoot, 'build.gradle.kts')) ||
        cachedExists(join(repoRoot, 'build.sbt'))
    );
}

export function detect(modulePath: string, repoRoot: string): string | null {
    // Java stdlib
    for (const prefix of JAVA_STDLIB_PREFIXES) {
        if (modulePath.startsWith(prefix)) {
            // Return the first two segments (e.g. java.util)
            const parts = modulePath.split('.');
            return parts.slice(0, 2).join('.');
        }
    }

    if (!hasJvmManifest(repoRoot)) {
        return null;
    }

    const deps = getOrLoadDeps('java', repoRoot, () => loadJavaBuildDeps(repoRoot));

    // Match groupId prefix against import path
    // e.g. groupId "org.springframework.boot" -> import "org.springframework.boot.SpringApplication"
    for (const dep of deps.packages) {
        const [groupId, artifactId] = dep.split(':');
        if (modulePath.startsWith(groupId)) {
            return artifactId;
        }
    }

    return null;
}
