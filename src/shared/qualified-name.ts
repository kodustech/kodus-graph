export function qualifiedName(filePath: string, name: string, className?: string, isTest?: boolean): string {
    if (isTest) {
        return `${filePath}::test:${name}`;
    }
    if (className) {
        return `${filePath}::${className}.${name}`;
    }
    return `${filePath}::${name}`;
}

/**
 * Per-class key for the DI map. The map stores both this scoped key and the
 * bare field name (as a fallback), so a call inside class `A` resolves
 * `this.repo` to `A`'s injected type even when another class in the same file
 * injects a different type into a field also named `repo`. It is stored alongside the bare field key as a fallback.
 */
export function diScopedKey(className: string, fieldName: string): string {
    // '#' can't appear in a class/field identifier, so the scoped key never
    // collides with the bare field key the DI map also stores.
    return `${className}#${fieldName}`;
}
