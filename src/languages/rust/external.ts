/**
 * Rust external-crate detection.
 *
 * `crate::`, `super::`, `self::` are local. `std`, `core`, `alloc` are
 * stdlib. Everything else is matched against Cargo.toml dependency names
 * (hyphens normalised to underscores).
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

const RUST_STDLIB_CRATES = new Set(['std', 'core', 'alloc']);

function loadDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const cargo = safeRead(join(repoRoot, 'Cargo.toml'));
    if (cargo) {
        let inDeps = false;
        for (const line of cargo.split('\n')) {
            const trimmed = line.trim();
            if (/^\[(.*dependencies.*)\]$/i.test(trimmed)) {
                inDeps = true;
                continue;
            }
            if (trimmed.startsWith('[') && inDeps) {
                inDeps = false;
                continue;
            }
            if (inDeps) {
                const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/);
                if (match) {
                    pkgs.add(match[1]);
                }
            }
        }
    }
    return { packages: pkgs };
}

export function detect(modulePath: string, repoRoot: string): string | null {
    const firstSegment = modulePath.split('::')[0];

    // crate:: and super:: and self:: are local
    if (firstSegment === 'crate' || firstSegment === 'super' || firstSegment === 'self') {
        return null;
    }

    // stdlib crates
    if (RUST_STDLIB_CRATES.has(firstSegment)) {
        return firstSegment;
    }

    if (!cachedExists(join(repoRoot, 'Cargo.toml'))) {
        return null;
    }

    const deps = getOrLoadDeps('rust', repoRoot, () => loadDeps(repoRoot));

    // Cargo dependency names use hyphens but Rust uses underscores
    const normalized = firstSegment.replace(/-/g, '_');
    for (const dep of deps.packages) {
        if (dep.replace(/-/g, '_') === normalized) {
            return dep;
        }
    }

    return null;
}
