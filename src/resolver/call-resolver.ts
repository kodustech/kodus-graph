/**
 * Call resolution with 5-tier confidence cascade.
 *
 * Cascade: DI (0.90-0.95) → same-file (0.85) → import-resolved (0.70-0.90)
 *        → unique-name (0.50) → ambiguous (0.30)
 *
 * Pure resolution logic — no file I/O, no parsing.
 * Raw call sites are provided by the batch parser.
 */

import type { RawCallEdge, RawCallSite } from '../graph/types';
import { NOISE } from '../shared/filters';
import type { ImportMap } from './import-map';
import type { SymbolTable } from './symbol-table';

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

// ── Batch resolution (pure, no I/O) ──

/**
 * Resolve all raw call sites via the 5-tier cascade.
 *
 * Accepts pre-extracted RawCallSite[] from the batch parser.
 * No file reads, no parseAsync — pure iteration + lookup.
 */
export function resolveAllCalls(
  rawCalls: RawCallSite[],
  diMaps: Map<string, Map<string, string>>,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): ResolveAllResult {
  const callEdges: RawCallEdge[] = [];
  const stats: CallResolverStats = { di: 0, same: 0, import: 0, unique: 0, ambiguous: 0, noise: 0 };

  for (const call of rawCalls) {
    if (NOISE.has(call.callName)) {
      stats.noise++;
      continue;
    }

    const fp = call.source;
    const diMap = diMaps.get(fp);

    // Try DI resolution first if diField is present
    if (call.diField) {
      const resolved = resolveDICall(call.diField, call.callName, fp, diMap, symbolTable);
      if (resolved) {
        callEdges.push({
          source: fp,
          target: resolved.target,
          callName: call.callName,
          line: call.line,
          confidence: resolved.confidence,
        });
        stats.di++;
        continue;
      }
    }

    // Class-aware resolution for self.X() and super().X()
    if (call.resolveInClass) {
      const classResolved = resolveInClass(call.callName, fp, call.resolveInClass, symbolTable);
      if (classResolved) {
        callEdges.push({
          source: fp,
          target: classResolved.target,
          callName: call.callName,
          line: call.line,
          confidence: classResolved.confidence,
        });
        stats[classResolved.strategy]++;
        continue;
      }
    }

    // Name-based cascade fallback
    const resolved = resolveByName(call.callName, fp, symbolTable, importMap);
    if (resolved) {
      callEdges.push({
        source: fp,
        target: resolved.target,
        callName: call.callName,
        line: call.line,
        confidence: resolved.confidence,
      });
      stats[resolved.strategy]++;
    }
  }

  return { callEdges, stats };
}

// ── Class-aware resolution (self./super.) ──

function resolveInClass(
  callName: string,
  currentFile: string,
  className: string,
  symbolTable: SymbolTable,
): ResolveResult | null {
  // Try same-file class method first (self.method() or super().method())
  const inFile = symbolTable.lookupInFile(currentFile, callName, className);
  if (inFile) return { target: inFile, confidence: 0.9, strategy: 'same' };

  // Class might be in another file (imported parent class for super())
  const candidates = symbolTable.lookupGlobal(callName);
  const match = candidates.find((q) => q.includes(`::${className}.${callName}`));
  if (match) return { target: match, confidence: 0.85, strategy: 'import' };

  return null;
}

// ── DI resolution ──

function resolveDICall(
  fieldName: string,
  methodName: string,
  _currentFile: string,
  diMap: Map<string, string> | undefined,
  symbolTable: SymbolTable,
): ResolveResult | null {
  if (!diMap?.has(fieldName)) return null;

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
      return { target: `${implFile}::${implName}.${methodName}`, confidence: 0.9, strategy: 'di' };
    }
  }

  return null;
}

// ── Name-based resolution (4-tier cascade) ──

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
    if (targetSym) return { target: targetSym, confidence: 0.9, strategy: 'import' };
    return { target: `${importedFrom}::${callName}`, confidence: 0.7, strategy: 'import' };
  }

  // Strategy 3: Unique global name (0.50)
  if (symbolTable.isUnique(callName)) {
    const candidates = symbolTable.lookupGlobal(callName);
    return { target: candidates[0], confidence: 0.5, strategy: 'unique' };
  }

  // Strategy 4: Ambiguous (0.30) — pick closest candidate by directory proximity
  const candidates = symbolTable.lookupGlobal(callName);
  if (candidates.length > 1) {
    const best = pickClosestCandidate(candidates, currentFile);
    return { target: best, confidence: 0.3, strategy: 'ambiguous' };
  }

  return null;
}

// ── Proximity-based candidate selection ──

/**
 * Pick the candidate whose file path is closest to the caller's file.
 * Counts shared leading path segments — more shared = closer.
 */
function pickClosestCandidate(candidates: string[], callerFile: string): string {
  const callerParts = callerFile.split('/');
  let best = candidates[0];
  let bestScore = -1;

  for (const candidate of candidates) {
    const candidateFile = candidate.includes('::') ? candidate.split('::')[0] : candidate;
    const parts = candidateFile.split('/');
    let shared = 0;
    for (let i = 0; i < Math.min(callerParts.length, parts.length); i++) {
      if (callerParts[i] === parts[i]) shared++;
      else break;
    }
    if (shared > bestScore) {
      bestScore = shared;
      best = candidate;
    }
  }

  return best;
}

// ── Public wrapper for unit testing ──

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
