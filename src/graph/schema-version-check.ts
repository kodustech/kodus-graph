// src/graph/schema-version-check.ts
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
