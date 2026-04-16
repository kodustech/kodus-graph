/**
 * TypeScript / JavaScript external-package detection.
 *
 * Considers relative and `#`-prefixed imports as local. Node built-ins
 * (with or without `node:` prefix) and Bun built-ins return their specifier
 * directly. Anything else that is a bare specifier is assumed external —
 * either listed in package.json or at least not a relative path.
 */

import { join } from 'path';
import { getOrLoadDeps, type LangDeps, safeParseJson } from '../external-shared';

const NODE_BUILTINS = new Set([
    'fs',
    'path',
    'os',
    'http',
    'https',
    'http2',
    'net',
    'stream',
    'buffer',
    'url',
    'util',
    'crypto',
    'events',
    'child_process',
    'cluster',
    'dns',
    'readline',
    'repl',
    'tls',
    'vm',
    'zlib',
    'assert',
    'async_hooks',
    'console',
    'constants',
    'dgram',
    'diagnostics_channel',
    'domain',
    'inspector',
    'module',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'string_decoder',
    'timers',
    'tty',
    'v8',
    'wasi',
    'worker_threads',
]);

function loadDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const pkg = safeParseJson(join(repoRoot, 'package.json'));
    if (pkg) {
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            const deps = pkg[field];
            if (deps && typeof deps === 'object') {
                for (const name of Object.keys(deps as Record<string, unknown>)) {
                    pkgs.add(name);
                }
            }
        }
    }
    return { packages: pkgs };
}

export function detect(modulePath: string, repoRoot: string): string | null {
    // Relative and #-prefixed imports are never external
    if (modulePath.startsWith('.') || modulePath.startsWith('#')) {
        return null;
    }

    // Node / Bun built-ins (with or without the protocol prefix)
    if (modulePath.startsWith('node:')) {
        return modulePath;
    }
    if (modulePath.startsWith('bun:')) {
        return modulePath;
    }
    if (NODE_BUILTINS.has(modulePath)) {
        return modulePath;
    }
    const bareNode = modulePath.split('/')[0];
    if (NODE_BUILTINS.has(bareNode)) {
        return bareNode;
    }

    const deps = getOrLoadDeps('typescript', repoRoot, () => loadDeps(repoRoot));

    // Scoped package: @scope/name or @scope/name/subpath
    if (modulePath.startsWith('@')) {
        const parts = modulePath.split('/');
        const scopedName = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : modulePath;
        if (deps.packages.has(scopedName)) {
            return scopedName;
        }
        // Bare specifier not in deps but doesn't start with . or # → likely external
        return scopedName;
    }

    // Non-scoped bare specifier
    const topLevel = modulePath.split('/')[0];
    if (deps.packages.has(topLevel)) {
        return topLevel;
    }

    // Bare specifier not found in deps — still likely external (unlisted dep)
    return topLevel;
}
