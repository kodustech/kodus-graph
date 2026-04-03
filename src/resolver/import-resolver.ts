/**
 * Import resolver dispatcher.
 *
 * Routes import resolution to language-specific resolvers and
 * falls back to tsconfig aliases for TypeScript/JavaScript.
 */

import { resolve as resolveTsImport, resolveWithAliases, loadTsconfigAliases } from './languages/typescript';
import { resolve as resolvePyImport } from './languages/python';
import { resolve as resolveRbImport } from './languages/ruby';
import { resolve as resolveGoImport } from './languages/go';
import { resolve as resolveJavaImport } from './languages/java';
import { resolve as resolveRustImport } from './languages/rust';
import { resolve as resolveCsImport } from './languages/csharp';
import { resolve as resolvePhpImport } from './languages/php';
import { ensureWithinRoot } from '../shared/safe-path';
import { log } from '../shared/logger';

const RESOLVERS: Record<string, (from: string, mod: string, root: string) => string | null> = {
  ts: resolveTsImport,
  javascript: resolveTsImport,
  typescript: resolveTsImport,
  python: resolvePyImport,
  ruby: resolveRbImport,
  go: resolveGoImport,
  java: resolveJavaImport,
  rust: resolveRustImport,
  csharp: resolveCsImport,
  php: resolvePhpImport,
};

/**
 * Resolve an import from one file to another.
 *
 * @param fromAbsFile - Absolute path of the importing file
 * @param modulePath - The import specifier (e.g., './auth', 'express', '@/lib/db')
 * @param lang - Language key (ts, javascript, typescript, python, ruby, etc.)
 * @param repoRoot - Absolute path to the repository root
 * @param tsconfigAliases - Optional pre-loaded tsconfig aliases for TS/JS
 * @returns Absolute path to the resolved file, or null if unresolvable
 */
export function resolveImport(
  fromAbsFile: string,
  modulePath: string,
  lang: string,
  repoRoot: string,
  tsconfigAliases?: Map<string, string[]>,
): string | null {
  const resolver = RESOLVERS[lang];
  if (!resolver) return null;

  let result = resolver(fromAbsFile, modulePath, repoRoot);

  // Fallback: tsconfig aliases for TS/JS
  if (!result && (lang === 'ts' || lang === 'javascript' || lang === 'typescript') && tsconfigAliases?.size) {
    result = resolveWithAliases(modulePath, tsconfigAliases, repoRoot);
  }

  // Validate resolved path is within repo root
  if (result) {
    try {
      ensureWithinRoot(result, repoRoot);
    } catch {
      log.warn('Import resolves outside repository root', { from: fromAbsFile, module: modulePath, resolved: result });
      return null;
    }
  }

  return result;
}

export { loadTsconfigAliases };
