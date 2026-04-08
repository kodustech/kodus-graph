/**
 * Python import resolver.
 *
 * Handles dotted module paths (e.g., "from x.y import z").
 * Walks up directories to find packages.
 */

import { readFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

/**
 * Resolve a Python dotted import to a file path.
 * Walks up from the importing file's directory to find the module.
 */
export function resolve(fromAbsFile: string, modulePath: string, _repoRoot: string): string | null {
    if (!modulePath) {
        return null;
    }

    if (modulePath.startsWith('.')) {
        // Relative import: count leading dots, walk up directories
        const dotMatch = modulePath.match(/^(\.+)/);
        const dots = dotMatch![1].length;
        const rest = modulePath.slice(dots).replace(/\./g, '/');

        let base = dirname(fromAbsFile);
        for (let d = 1; d < dots; d++) {
            base = dirname(base);
        }

        const candidates = rest ? [`${rest}.py`, `${rest}/__init__.py`] : [`__init__.py`];

        for (const candidate of candidates) {
            const full = join(base, candidate);
            if (cachedExists(full)) {
                return resolvePath(full);
            }
        }

        return null;
    }

    const parts = modulePath.replace(/\./g, '/');
    let current = dirname(fromAbsFile);

    for (let i = 0; i < 10; i++) {
        for (const candidate of [`${parts}.py`, `${parts}/__init__.py`]) {
            const full = join(current, candidate);
            if (cachedExists(full)) {
                return resolvePath(full);
            }
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    // Fallback: check setup.cfg for package_dir directive (e.g., package_dir = = src)
    const setupCfgResult = resolveViaSetupCfg(parts, _repoRoot);
    if (setupCfgResult) {
        return setupCfgResult;
    }

    // Fallback: check pyproject.toml for package-dir (e.g., [tool.setuptools.package-dir] "" = "src")
    const pyprojectResult = resolveViaPyprojectPackageDir(parts, _repoRoot);
    if (pyprojectResult) {
        return pyprojectResult;
    }

    return null;
}

/**
 * Try resolving via setup.cfg package_dir directive.
 * Looks for patterns like:
 *   [options]
 *   package_dir =
 *       = src
 * which means the root package directory is "src/".
 */
function resolveViaSetupCfg(relPath: string, repoRoot: string): string | null {
    const setupCfgPath = join(repoRoot, 'setup.cfg');
    if (!cachedExists(setupCfgPath)) {
        return null;
    }

    try {
        const content = readFileSync(setupCfgPath, 'utf-8');

        // Look for package_dir under [options]
        // Common patterns:
        //   package_dir =
        //       = src
        //   package_dir = = src
        const packageDirRegex = /package_dir\s*=\s*(?:\n\s+)?=\s*(\S+)/;
        const match = packageDirRegex.exec(content);
        if (match) {
            const srcDir = match[1];
            for (const candidate of [`${relPath}.py`, `${relPath}/__init__.py`]) {
                const full = join(repoRoot, srcDir, candidate);
                if (cachedExists(full)) {
                    return resolvePath(full);
                }
            }
        }
    } catch {
        // setup.cfg read failed, continue
    }

    return null;
}

/**
 * Try resolving via pyproject.toml [tool.setuptools.package-dir] directive.
 */
function resolveViaPyprojectPackageDir(relPath: string, repoRoot: string): string | null {
    const pyprojectPath = join(repoRoot, 'pyproject.toml');
    if (!cachedExists(pyprojectPath)) {
        return null;
    }

    try {
        const content = readFileSync(pyprojectPath, 'utf-8');

        // Look for [tool.setuptools.package-dir] section with "" = "src" or similar
        const packageDirRegex = /\[tool\.setuptools\.package-dir\]\s*\n\s*""\s*=\s*"(\S+)"/;
        const match = packageDirRegex.exec(content);
        if (match) {
            const srcDir = match[1];
            for (const candidate of [`${relPath}.py`, `${relPath}/__init__.py`]) {
                const full = join(repoRoot, srcDir, candidate);
                if (cachedExists(full)) {
                    return resolvePath(full);
                }
            }
        }
    } catch {
        // pyproject.toml read failed, continue
    }

    return null;
}
