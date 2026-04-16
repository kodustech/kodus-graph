/**
 * Dart import resolver.
 *
 * Dart has three import styles:
 * 1. `import 'dart:async'` — SDK library, return null
 * 2. `import 'package:name/path.dart'` — package import, resolve via pubspec.yaml
 * 3. `import '../relative.dart'` — relative import, resolve path
 */

import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

// ---------------------------------------------------------------------------
// Dart SDK libraries (return null for these)
// ---------------------------------------------------------------------------

const DART_SDK_PREFIXES = ['dart:'];

// ---------------------------------------------------------------------------
// Well-known Flutter/Dart framework packages
// ---------------------------------------------------------------------------

const DART_FRAMEWORK_PACKAGES = new Set([
    'flutter',
    'flutter_test',
    'flutter_driver',
    'flutter_localizations',
    'flutter_web_plugins',
    'sky_engine',
]);

// ---------------------------------------------------------------------------
// Source directory candidates for Dart/Flutter projects
// ---------------------------------------------------------------------------

const _SOURCE_DIRS = ['lib', 'src', 'lib/src'];

// ---------------------------------------------------------------------------
// pubspec.yaml parser (minimal)
// ---------------------------------------------------------------------------

interface PubspecDeps {
    name: string;
    dependencies: Set<string>;
}

function parsePubspec(repoRoot: string): PubspecDeps | null {
    const pubspecPath = join(repoRoot, 'pubspec.yaml');
    if (!cachedExists(pubspecPath)) {
        return null;
    }

    try {
        const { readFileSync } = require('fs');
        const text = readFileSync(pubspecPath, 'utf-8');

        // Extract package name
        const nameMatch = text.match(/^name:\s*(.+)$/m);
        const name = nameMatch ? nameMatch[1].trim() : '';

        // Extract dependency names (simple line-based parsing)
        const deps = new Set<string>();
        let inDeps = false;
        for (const line of text.split('\n')) {
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
                    deps.add(depMatch[1]);
                }
            }
        }

        return { name, dependencies: deps };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolve(fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    // 1. SDK imports: dart:xxx → null
    if (DART_SDK_PREFIXES.some((prefix) => modulePath.startsWith(prefix))) {
        return null;
    }

    // 2. Package imports: package:name/path.dart
    if (modulePath.startsWith('package:')) {
        const withoutPrefix = modulePath.slice('package:'.length); // "name/path.dart"
        const slashIdx = withoutPrefix.indexOf('/');
        if (slashIdx === -1) {
            return null; // malformed
        }

        const packageName = withoutPrefix.slice(0, slashIdx);
        const pathInPackage = withoutPrefix.slice(slashIdx + 1); // "path.dart" or "models/user.dart"

        // Framework packages → null
        if (DART_FRAMEWORK_PACKAGES.has(packageName)) {
            return null;
        }

        // Check if it's the project's own package
        const pubspec = parsePubspec(repoRoot);
        if (pubspec && pubspec.name === packageName) {
            // Resolve within the project's lib directory
            const libPath = join(repoRoot, 'lib', pathInPackage);
            if (cachedExists(libPath)) {
                return resolvePath(libPath);
            }
            return null;
        }

        // External package — check if it's a known dependency
        if (pubspec?.dependencies.has(packageName)) {
            return null; // external dependency
        }

        // Try resolving in local packages (monorepo)
        const monoPath = join(repoRoot, 'packages', packageName, 'lib', pathInPackage);
        if (cachedExists(monoPath)) {
            return resolvePath(monoPath);
        }

        return null;
    }

    // 3. Relative imports: ./foo.dart, ../bar.dart, foo.dart
    const dir = dirname(fromAbsFile);
    const resolved = resolvePath(dir, modulePath);
    if (cachedExists(resolved)) {
        return resolved;
    }

    // Try appending .dart if not already present
    if (!modulePath.endsWith('.dart')) {
        const withExt = `${resolved}.dart`;
        if (cachedExists(withExt)) {
            return withExt;
        }
    }

    return null;
}
