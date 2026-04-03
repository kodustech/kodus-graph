/**
 * TypeScript/JavaScript import resolver.
 *
 * Handles:
 * - Relative imports with extension probing (.ts, .tsx, .js, .jsx)
 * - ESM .js → .ts remapping
 * - Directory index files
 * - tsconfig path aliases
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve as resolvePath } from 'path';
import { log } from '../../shared/logger';

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Resolve a TypeScript/JavaScript relative import to an absolute file path.
 * Returns null for non-relative (external package) imports.
 */
export function resolve(
  fromAbsFile: string,
  modulePath: string,
  repoRoot: string,
): string | null {
  if (!modulePath.startsWith('.')) return null;

  let base = join(dirname(fromAbsFile), modulePath);

  // ESM convention: .js in import -> .ts on disk
  if (modulePath.endsWith('.js')) base = base.slice(0, -3);

  // Try direct with extension
  for (const ext of TS_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate)) return resolvePath(candidate);
  }

  // Try index file in directory
  for (const ext of TS_EXTENSIONS) {
    const candidate = join(base, `index${ext}`);
    if (existsSync(candidate)) return resolvePath(candidate);
  }

  return null;
}

/**
 * Strip comments and trailing commas from JSON (tsconfig-compatible).
 * Handles strings correctly -- won't strip // inside "url://..." etc.
 */
function stripJsonComments(str: string): string {
  let result = '';
  let i = 0;
  const len = str.length;

  while (i < len) {
    // String literal -- copy as-is
    if (str[i] === '"') {
      let j = i + 1;
      while (j < len && str[j] !== '"') {
        if (str[j] === '\\') j++; // skip escaped char
        j++;
      }
      result += str.substring(i, j + 1);
      i = j + 1;
      continue;
    }

    // Single-line comment
    if (str[i] === '/' && str[i + 1] === '/') {
      while (i < len && str[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (str[i] === '/' && str[i + 1] === '*') {
      i += 2;
      while (i < len && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Trailing comma: comma followed by optional whitespace + closing bracket
    if (str[i] === ',') {
      let j = i + 1;
      while (j < len && (str[j] === ' ' || str[j] === '\t' || str[j] === '\n' || str[j] === '\r')) j++;
      if (str[j] === '}' || str[j] === ']') {
        i++;
        continue;
      }
    }

    result += str[i];
    i++;
  }

  return result;
}

/**
 * Load and parse tsconfig.json path aliases.
 *
 * Tries tsconfig.json first, then tsconfig.base.json.
 * Converts alias patterns like "@libs/*" into prefix → resolved dirs.
 */
export function loadTsconfigAliases(repoRoot: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>();

  for (const filename of ['tsconfig.json', 'tsconfig.base.json']) {
    const tsconfigPath = join(repoRoot, filename);
    if (!existsSync(tsconfigPath)) continue;

    try {
      const content = readFileSync(tsconfigPath, 'utf-8');
      const cleaned = stripJsonComments(content);
      const config = JSON.parse(cleaned);
      const paths = config?.compilerOptions?.paths;
      const baseUrl = config?.compilerOptions?.baseUrl || '.';
      const baseDir = join(repoRoot, baseUrl);

      if (paths) {
        for (const [alias, targets] of Object.entries(paths)) {
          // Convert alias pattern: "@libs/*" -> prefix "@libs/"
          const prefix = alias.replace('/*', '/').replace('*', '');
          const resolvedTargets = (targets as string[]).map(t => {
            const targetPath = t.replace('/*', '').replace('*', '');
            return join(baseDir, targetPath);
          });
          aliases.set(prefix, resolvedTargets);
        }
      }
    } catch (err) {
      log.warn('Failed to parse tsconfig', { file: tsconfigPath, error: String(err) });
    }
  }

  return aliases;
}

/**
 * Resolve an import path using tsconfig aliases.
 *
 * Tries each alias prefix, and for matches, probes extensions and index files.
 */
export function resolveWithAliases(
  modulePath: string,
  aliases: Map<string, string[]>,
  repoRoot: string,
): string | null {
  for (const [prefix, targets] of aliases) {
    if (modulePath.startsWith(prefix)) {
      const rest = modulePath.slice(prefix.length);

      for (const targetBase of targets) {
        const base = join(targetBase, rest);

        for (const ext of TS_EXTENSIONS) {
          if (existsSync(base + ext)) return resolvePath(base + ext);
        }
        for (const ext of TS_EXTENSIONS) {
          const idx = join(base, `index${ext}`);
          if (existsSync(idx)) return resolvePath(idx);
        }
        // Try exact match (for directories with index)
        if (existsSync(base)) return resolvePath(base);
      }
    }
  }

  return null;
}
