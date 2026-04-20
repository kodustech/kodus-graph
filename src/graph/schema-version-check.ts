// src/graph/schema-version-check.ts

import { SCHEMA_VERSION } from '../shared/constants';
import { log } from '../shared/logger';

export type SchemaVersionRelation = 'same' | 'older-minor' | 'older-major' | 'newer-minor' | 'newer-major';

function parseMajorMinor(v: string): { major: number; minor: number } | null {
    const parts = v.split('.');
    const major = Number.parseInt(parts[0] ?? '', 10);
    const minor = Number.parseInt(parts[1] ?? '0', 10);
    if (Number.isNaN(major)) {
        return null;
    }
    return { major, minor: Number.isNaN(minor) ? 0 : minor };
}

/**
 * Compare two kodus-graph schema versions in "major.minor" format.
 *
 * Returns 'older-major' as a cautious default for malformed inputs so that
 * callers print the "breaking change" warning rather than silently proceeding.
 */
export function compareSchemaVersions(loaded: string, current: string): SchemaVersionRelation {
    const loadedV = parseMajorMinor(loaded);
    const currentV = parseMajorMinor(current);
    if (!loadedV || !currentV) {
        return 'older-major';
    }
    if (loadedV.major === currentV.major && loadedV.minor === currentV.minor) {
        return 'same';
    }
    if (loadedV.major > currentV.major) {
        return 'newer-major';
    }
    if (loadedV.major < currentV.major) {
        return 'older-major';
    }
    if (loadedV.minor > currentV.minor) {
        return 'newer-minor';
    }
    return 'older-minor';
}

/**
 * Enforce schema version on a raw parsed graph (any JSON object with a
 * `metadata.schema_version` field). Throws on newer major (we can't know
 * what changed), warns on older major or missing, silently accepts same
 * or minor diffs.
 *
 * Shared between `loadGraph` (in loader.ts) and the analyze/context
 * commands which each have their own graph-loading paths via
 * `GraphInputSchema`. Without this shared helper, analyze/context silently
 * accept any schema version.
 */
export function enforceSchemaVersion(raw: unknown): void {
    const metadata = (raw as { metadata?: { schema_version?: unknown } } | null | undefined)?.metadata;
    const loadedVersion = metadata && typeof metadata.schema_version === 'string' ? metadata.schema_version : undefined;

    if (!loadedVersion) {
        log.warn('graph has no schema_version; assuming legacy (pre-1.0). Some features may behave incorrectly.');
        return;
    }

    const rel = compareSchemaVersions(loadedVersion, SCHEMA_VERSION);
    if (rel === 'newer-major') {
        throw new Error(
            `graph schema v${loadedVersion} is newer than this kodus-graph version (v${SCHEMA_VERSION}). ` +
                `Upgrade kodus-graph or regenerate the graph with a compatible version.`,
        );
    }
    if (rel === 'older-major') {
        log.warn(
            `graph is v${loadedVersion}, code expects v${SCHEMA_VERSION} (breaking change). ` +
                'Consider re-running `kodus-graph parse` to regenerate.',
        );
    }
    // older-minor / newer-minor / same -> proceed silently (minor bumps are additive).
}
