/**
 * Import resolver for C and C++.
 *
 * Resolution rules:
 * - `#include <header.h>` (system includes) -> null (external/system header)
 * - `#include "file.h"` (local includes) -> resolve relative to source file, then project root
 *
 * Extension probing order: try as-is, then .h, .hpp, .c, .cpp
 */

import { dirname, join, resolve as resolvePath } from 'path';
import { cachedExists } from '../fs-cache';

const EXTENSIONS = ['.h', '.hpp', '.hh', '.c', '.cpp', '.cc', '.cxx'];

/**
 * Probe for a file at the given base path, trying the original path first,
 * then appending common C/C++ extensions.
 */
function probe(basePath: string): string | null {
    // Try exact path first
    if (cachedExists(basePath)) {
        return resolvePath(basePath);
    }

    // Try adding extensions
    for (const ext of EXTENSIONS) {
        const candidate = basePath + ext;
        if (cachedExists(candidate)) {
            return resolvePath(candidate);
        }
    }

    return null;
}

/**
 * Resolve a C/C++ #include directive to an absolute file path.
 *
 * @param fromAbsFile - Absolute path of the file containing the #include
 * @param modulePath - The include path (e.g., "utils.h", "models/user.h")
 * @param repoRoot - Absolute path to the repository root
 * @returns Absolute path to the resolved header/source file, or null
 */
export function resolve(fromAbsFile: string, modulePath: string, repoRoot: string): string | null {
    // System includes (angle brackets) are stripped to just the path by the extractor.
    // We identify system includes by checking if the path does NOT exist locally.
    // However, the extractor stores both system and local includes the same way.
    // We rely on external-detector.ts for system include detection.

    // 1. Try relative to the source file's directory
    const sourceDir = dirname(fromAbsFile);
    const relativeResult = probe(join(sourceDir, modulePath));
    if (relativeResult) {
        return relativeResult;
    }

    // 2. Try relative to the project root (common for project-wide includes)
    const rootResult = probe(join(repoRoot, modulePath));
    if (rootResult) {
        return rootResult;
    }

    // 3. Try common include directories: src/, include/, inc/
    const includeDirs = ['src', 'include', 'inc'];
    for (const dir of includeDirs) {
        const result = probe(join(repoRoot, dir, modulePath));
        if (result) {
            return result;
        }
    }

    return null;
}
