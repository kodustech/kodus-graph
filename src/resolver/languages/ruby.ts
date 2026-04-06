/**
 * Ruby import resolver.
 *
 * Handles require_relative paths.
 */

import { existsSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';

/**
 * Resolve a Ruby require/require_relative to a file path.
 */
export function resolve(fromAbsFile: string, modulePath: string, _repoRoot: string): string | null {
  if (!modulePath) return null;

  const base = join(dirname(fromAbsFile), modulePath);
  if (existsSync(`${base}.rb`)) return resolvePath(`${base}.rb`);
  if (existsSync(base)) return resolvePath(base);

  return null;
}
