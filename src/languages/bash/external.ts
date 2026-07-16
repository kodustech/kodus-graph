/**
 * Bash external-dependency detection.
 *
 * Shell has no package registry — `source`/`.` always name a local file path.
 * A path that the resolver could not locate on disk is a broken/optional
 * source, not a third-party package, so nothing here is ever "external". The
 * detector exists only to satisfy the per-language dispatch contract.
 */
export function detect(_modulePath: string, _repoRoot: string): string | null {
    return null;
}
