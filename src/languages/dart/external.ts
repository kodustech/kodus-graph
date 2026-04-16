/**
 * Dart external-package detection.
 *
 * - `dart:xxx` SDK imports are system
 * - `package:flutter/…` and other framework packages are system
 * - `package:<own>/…` matches pubspec.yaml's own name → local
 * - `package:<pkgName>/…` matches pubspec.yaml deps → external
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

const DART_FRAMEWORK_PACKAGES = new Set([
    'flutter',
    'flutter_test',
    'flutter_driver',
    'flutter_localizations',
    'flutter_web_plugins',
    'sky_engine',
]);

function loadDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const meta: Record<string, string> = {};
    const pubspec = safeRead(join(repoRoot, 'pubspec.yaml'));
    if (pubspec) {
        // Extract package name
        const nameMatch = pubspec.match(/^name:\s*(.+)$/m);
        if (nameMatch) {
            meta.name = nameMatch[1].trim();
        }

        // Extract dependency names (simple line-based parsing)
        let inDeps = false;
        for (const line of pubspec.split('\n')) {
            const trimmed = line.trim();
            if (/^(dependencies|dev_dependencies|dependency_overrides):/.test(trimmed)) {
                inDeps = true;
                continue;
            }
            // New top-level key — stop collecting
            if (/^[a-zA-Z_].*:/.test(trimmed) && !trimmed.startsWith(' ') && !trimmed.startsWith('#')) {
                if (inDeps) {
                    inDeps = false;
                }
                continue;
            }
            if (inDeps) {
                const depMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
                if (depMatch) {
                    pkgs.add(depMatch[1]);
                }
            }
        }
    }
    return { packages: pkgs, meta };
}

export function detect(modulePath: string, repoRoot: string): string | null {
    // SDK imports: dart:xxx
    if (modulePath.startsWith('dart:')) {
        return modulePath;
    }

    // Framework packages
    if (modulePath.startsWith('package:')) {
        const withoutPrefix = modulePath.slice('package:'.length);
        const packageName = withoutPrefix.split('/')[0];

        if (DART_FRAMEWORK_PACKAGES.has(packageName)) {
            return packageName;
        }

        if (!cachedExists(join(repoRoot, 'pubspec.yaml'))) {
            return null;
        }

        const deps = getOrLoadDeps('dart', repoRoot, () => loadDeps(repoRoot));
        if (deps.meta?.name === packageName) {
            return null; // own package, not external
        }
        if (deps.packages.has(packageName)) {
            return packageName;
        }
        return null;
    }

    // Relative imports are never external
    if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
        return null;
    }

    return null;
}
