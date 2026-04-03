/**
 * Call resolution with 5-tier confidence cascade.
 *
 * Cascade: DI (0.90-0.95) → same-file (0.85) → import-resolved (0.70-0.90)
 *        → unique-name (0.50) → ambiguous (0.30)
 *
 * Direct port of poc/src/call-resolver.mjs with TypeScript types.
 */

import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { extname, relative } from 'path';
import { getLanguage, isTypeScriptLike } from '../parser/languages';
import { NOISE } from '../shared/filters';
import type { RawCallEdge } from '../graph/types';
import type { SymbolTable } from './symbol-table';
import type { ImportMap } from './import-map';

// ── Types ──

interface ResolveResult {
  target: string;
  confidence: number;
  strategy: 'di' | 'same' | 'import' | 'unique' | 'ambiguous';
}

interface CallResolverStats {
  di: number;
  same: number;
  import: number;
  unique: number;
  ambiguous: number;
  noise: number;
}

interface ResolveAllResult {
  callEdges: RawCallEdge[];
  stats: CallResolverStats;
}

// ── Batch resolution ──

/**
 * Extract and resolve all function calls from files.
 *
 * Re-parses each file to find call expressions, then resolves each call
 * via the 5-tier cascade: DI → same-file → import → unique → ambiguous.
 */
export async function resolveAllCalls(
  files: string[],
  repoRoot: string,
  diMaps: Map<string, Map<string, string>>,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): Promise<ResolveAllResult> {
  const callEdges: RawCallEdge[] = [];
  const stats: CallResolverStats = { di: 0, same: 0, import: 0, unique: 0, ambiguous: 0, noise: 0 };
  const BATCH = 50;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);

    const promises = batch.map(async (filePath) => {
      const lang = getLanguage(extname(filePath));
      if (!lang) return [];

      let source: string;
      try { source = readFileSync(filePath, 'utf-8'); } catch { return []; }

      let root;
      try { root = (await parseAsync(lang, source)).root(); } catch { return []; }

      const fp = relative(repoRoot, filePath);
      const diMap = diMaps.get(fp);
      const isTSLike = isTypeScriptLike(lang);
      const localCalls: RawCallEdge[] = [];

      // this.field.method() — TS DI pattern
      if (isTSLike) {
        for (const m of root.findAll('this.$FIELD.$METHOD($$$ARGS)')) {
          const field = m.getMatch('FIELD')?.text();
          const method = m.getMatch('METHOD')?.text();
          if (!method || NOISE.has(method)) { stats.noise++; continue; }

          const resolved = resolveDICall(field, method, fp, diMap, symbolTable);
          if (resolved) {
            localCalls.push({
              source: fp,
              target: resolved.target,
              callName: method,
              line: m.range().start.line,
              confidence: resolved.confidence,
            });
            stats.di++;
          } else {
            const fallback = resolveByName(method, fp, symbolTable, importMap);
            if (fallback) {
              localCalls.push({
                source: fp,
                target: fallback.target,
                callName: method,
                line: m.range().start.line,
                confidence: fallback.confidence,
              });
              stats[fallback.strategy]++;
            }
          }
        }
      }

      // Direct calls: $CALLEE($$$ARGS)
      for (const m of root.findAll('$CALLEE($$$ARGS)')) {
        const callee = m.getMatch('CALLEE')?.text();
        if (!callee || callee.startsWith('this.')) continue;

        const callName = callee.includes('.') ? callee.split('.').pop()! : callee;
        if (NOISE.has(callName)) { stats.noise++; continue; }

        const resolved = resolveByName(callName, fp, symbolTable, importMap);
        if (resolved) {
          localCalls.push({
            source: fp,
            target: resolved.target,
            callName,
            line: m.range().start.line,
            confidence: resolved.confidence,
          });
          stats[resolved.strategy]++;
        }
      }

      return localCalls;
    });

    const results = await Promise.all(promises);
    for (const calls of results) callEdges.push(...calls);
  }

  return { callEdges, stats };
}

// ── DI resolution ──

/**
 * Resolve a DI call: this.fieldName.methodName → ClassName.methodName
 *
 * Uses the diMap to find the type of the injected field,
 * then looks up that type in the symbol table.
 * Falls back to ISomething → Something heuristic for interfaces.
 */
function resolveDICall(
  fieldName: string | undefined,
  methodName: string,
  currentFile: string,
  diMap: Map<string, string> | undefined,
  symbolTable: SymbolTable,
): ResolveResult | null {
  if (!fieldName || !diMap?.has(fieldName)) return null;

  const typeName = diMap.get(fieldName)!;

  // Direct class match
  const candidates = symbolTable.lookupGlobal(typeName);
  if (candidates.length >= 1) {
    const typeFile = candidates[0].split('::')[0];
    return { target: `${typeFile}::${typeName}.${methodName}`, confidence: 0.95, strategy: 'di' };
  }

  // ISomething → Something heuristic for interface → implementation
  if (typeName.startsWith('I') && typeName[1] === typeName[1]?.toUpperCase()) {
    const implName = typeName.substring(1);
    const implCandidates = symbolTable.lookupGlobal(implName);
    if (implCandidates.length >= 1) {
      const implFile = implCandidates[0].split('::')[0];
      return { target: `${implFile}::${implName}.${methodName}`, confidence: 0.90, strategy: 'di' };
    }
  }

  return null;
}

// ── Name-based resolution (4-tier cascade) ──

/**
 * Resolve a call by name using the cascade:
 * same-file (0.85) → import-resolved (0.70-0.90) → unique-name (0.50) → ambiguous (0.30)
 */
function resolveByName(
  callName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): ResolveResult | null {
  // Strategy 1: Same file (0.85)
  const sameFile = symbolTable.lookupExact(currentFile, callName);
  if (sameFile) return { target: sameFile, confidence: 0.85, strategy: 'same' };

  // Strategy 2: Import-resolved (0.70-0.90)
  const importedFrom = importMap.lookup(currentFile, callName);
  if (importedFrom) {
    const targetSym = symbolTable.lookupExact(importedFrom, callName);
    if (targetSym) return { target: targetSym, confidence: 0.90, strategy: 'import' };
    return { target: `${importedFrom}::${callName}`, confidence: 0.70, strategy: 'import' };
  }

  // Strategy 3: Unique global name (0.50)
  if (symbolTable.isUnique(callName)) {
    const candidates = symbolTable.lookupGlobal(callName);
    return { target: candidates[0], confidence: 0.50, strategy: 'unique' };
  }

  // Strategy 4: Ambiguous (0.30)
  const candidates = symbolTable.lookupGlobal(callName);
  if (candidates.length > 1) {
    return { target: callName, confidence: 0.30, strategy: 'ambiguous' };
  }

  return null;
}

// ── Public wrapper for unit testing ──

/**
 * Resolve a single call by name with noise filtering.
 *
 * This is a simplified wrapper around resolveByName that adds NOISE filtering,
 * intended for unit testing and external consumers.
 */
export function resolveCall(
  callName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): { target: string; confidence: number } | null {
  if (NOISE.has(callName)) return null;

  const result = resolveByName(callName, currentFile, symbolTable, importMap);
  if (!result) return null;

  return { target: result.target, confidence: result.confidence };
}
