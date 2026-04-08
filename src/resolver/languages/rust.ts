import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join, resolve as resolvePath } from 'path';

function probeRustPath(baseDir: string, relPath: string): string | null {
    const asFile = join(baseDir, `${relPath}.rs`);
    if (existsSync(asFile)) {
        return resolvePath(asFile);
    }

    const asMod = join(baseDir, relPath, 'mod.rs');
    if (existsSync(asMod)) {
        return resolvePath(asMod);
    }

    const asLib = join(baseDir, relPath, 'lib.rs');
    if (existsSync(asLib)) {
        return resolvePath(asLib);
    }

    return null;
}

export function resolve(fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    if (modulePath.startsWith('std::')) {
        return null;
    }

    if (modulePath.startsWith('crate::')) {
        const rest = modulePath.slice('crate::'.length).replace(/::/g, '/');
        return probeRustPath(join(repoRoot, 'src'), rest);
    }

    if (modulePath.startsWith('super::')) {
        const rest = modulePath.slice('super::'.length).replace(/::/g, '/');
        const fileName = basename(fromAbsFile);
        // mod.rs and lib.rs represent their parent directory, so super:: goes up two levels
        const parentDir =
            fileName === 'mod.rs' || fileName === 'lib.rs' ? dirname(dirname(fromAbsFile)) : dirname(fromAbsFile);
        return probeRustPath(parentDir, rest);
    }

    if (modulePath.startsWith('self::')) {
        const rest = modulePath.slice('self::'.length).replace(/::/g, '/');
        return probeRustPath(dirname(fromAbsFile), rest);
    }

    // Try workspace path dependency resolution
    const firstSep = modulePath.indexOf('::');
    if (firstSep !== -1) {
        const crateName = modulePath.slice(0, firstSep);
        const rest = modulePath.slice(firstSep + 2).replace(/::/g, '/');
        const depPath = resolveWorkspacePathDep(fromAbsFile, crateName);
        if (depPath) {
            const srcDir = join(depPath, 'src');
            // Try the full path first, then progressively strip trailing segments
            // (they may be items like functions/structs inside a module file)
            const segments = rest.split('/');
            for (let i = segments.length; i >= 1; i--) {
                const partial = segments.slice(0, i).join('/');
                const result = probeRustPath(srcDir, partial);
                if (result) return result;
            }
        }

        // bin+lib same crate: if the first segment matches the local [package] name,
        // treat it like a crate:: import (resolve from src/)
        const localPkgName = findLocalPackageName(fromAbsFile);
        if (localPkgName && crateName === localPkgName) {
            const srcDir = join(findCrateDir(fromAbsFile)!, 'src');
            const segments = rest.split('/');
            for (let i = segments.length; i >= 1; i--) {
                const partial = segments.slice(0, i).join('/');
                const result = probeRustPath(srcDir, partial);
                if (result) return result;
            }
        }
    }

    return null;
}

/** Cache: crate dir → parsed {depName → resolved absolute path} */
const pathDepCache = new Map<string, Map<string, string>>();

/**
 * Walk up from `fromAbsFile` to find the nearest Cargo.toml,
 * parse its [dependencies] for `path = "..."` entries,
 * and return the absolute path of the dependency crate if it matches `depName`.
 */
function resolveWorkspacePathDep(fromAbsFile: string, depName: string): string | null {
    const crateDir = findCrateDir(fromAbsFile);
    if (!crateDir) return null;

    let deps = pathDepCache.get(crateDir);
    if (!deps) {
        deps = parsePathDeps(crateDir);
        pathDepCache.set(crateDir, deps);
    }

    return deps.get(depName) ?? null;
}

/**
 * Walk up from a file to find the nearest directory containing Cargo.toml.
 */
function findCrateDir(fromAbsFile: string): string | null {
    let dir = dirname(fromAbsFile);
    const root = resolvePath('/');
    while (dir !== root) {
        if (existsSync(join(dir, 'Cargo.toml'))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/** Cache: crate dir → parsed package name */
const pkgNameCache = new Map<string, string | null>();

/**
 * Find the [package] name from the nearest Cargo.toml for the given file.
 * Used to detect bin+lib same-crate imports (e.g. `use myapp::foo` from main.rs).
 */
function findLocalPackageName(fromAbsFile: string): string | null {
    const crateDir = findCrateDir(fromAbsFile);
    if (!crateDir) return null;

    const cached = pkgNameCache.get(crateDir);
    if (cached !== undefined) return cached;

    const cargoPath = join(crateDir, 'Cargo.toml');
    if (!existsSync(cargoPath)) {
        pkgNameCache.set(crateDir, null);
        return null;
    }

    const content = readFileSync(cargoPath, 'utf-8');
    const match = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
    // Cargo crate names use hyphens but Rust imports use underscores
    const name = match ? match[1].replace(/-/g, '_') : null;
    pkgNameCache.set(crateDir, name);
    return name;
}

/**
 * Parse Cargo.toml in `crateDir` for path dependencies.
 * Returns a map of dependency name → resolved absolute directory.
 *
 * Handles both inline table and multi-line table forms:
 *   shared = { path = "../shared" }
 *   [dependencies.shared]
 *   path = "../shared"
 */
function parsePathDeps(crateDir: string): Map<string, string> {
    const result = new Map<string, string>();
    const cargoPath = join(crateDir, 'Cargo.toml');
    if (!existsSync(cargoPath)) return result;

    const content = readFileSync(cargoPath, 'utf-8');
    const lines = content.split('\n');

    let inDepsSection = false;
    let depsTableDep: string | null = null; // for [dependencies.foo] style

    for (const line of lines) {
        const trimmed = line.trim();

        // Detect section headers
        if (trimmed.startsWith('[')) {
            // Check for [dependencies.foo] form
            const subMatch = trimmed.match(/^\[dependencies\.(\S+)\]$/);
            if (subMatch) {
                depsTableDep = subMatch[1];
                inDepsSection = false;
                continue;
            }

            depsTableDep = null;

            if (trimmed === '[dependencies]') {
                inDepsSection = true;
                continue;
            }

            // Any other section header ends [dependencies]
            inDepsSection = false;
            continue;
        }

        // Inside [dependencies.foo], look for path = "..."
        if (depsTableDep) {
            const pathMatch = trimmed.match(/^path\s*=\s*"([^"]+)"/);
            if (pathMatch) {
                const resolved = resolvePath(crateDir, pathMatch[1]);
                result.set(depsTableDep, resolved);
            }
            continue;
        }

        // Inside [dependencies], look for inline table with path
        if (inDepsSection && trimmed.length > 0 && !trimmed.startsWith('#')) {
            // name = { path = "..." ... }
            const inlineMatch = trimmed.match(/^(\S+)\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"[^}]*\}/);
            if (inlineMatch) {
                const resolved = resolvePath(crateDir, inlineMatch[2]);
                result.set(inlineMatch[1], resolved);
            }
        }
    }

    return result;
}
