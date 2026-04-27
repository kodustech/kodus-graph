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
import { getDIHeuristicsFor } from '../languages/engine';
import { languageOfFile } from '../languages/language-of-file';
import { getNoiseFor } from '../languages/noise-registry';
import type { ImportMap } from './import-map';
import type { SymbolTable } from './symbol-table';

// ── Types ──

interface ResolveResult {
    target: string;
    confidence: number;
    strategy: 'di' | 'same' | 'import' | 'unique' | 'ambiguous' | 'receiver';
    /** Non-picked candidates — populated only at the ambiguous tier (0.30). */
    alternatives?: string[];
}

interface CallResolverStats {
    di: number;
    same: number;
    import: number;
    unique: number;
    ambiguous: number;
    noise: number;
    ambiguousNoise: number;
    /**
     * Receiver-type-aware resolutions (new high-confidence tier at 0.95 /
     * 0.90). Triggered when `RawCallSite.receiverType` is set and the
     * symbol table has a matching `::Type.method` qualified name.
     */
    receiver: number;
}

interface ResolveAllResult {
    callEdges: RawCallEdge[];
    stats: CallResolverStats;
}

// ── Tier pipeline ──

/**
 * Per-call resolution context — recomputed for each call but stable across
 * tiers. Threading it through tiers keeps each tier focused on its tier
 * decision and avoids re-deriving file/lang lookups per tier.
 */
interface ResolverContext {
    fp: string;
    diMap: Map<string, string> | undefined;
    symbolTable: SymbolTable;
    importMap: ImportMap;
    totalIndexedFiles: number;
}

type StatsKey = keyof CallResolverStats;

/**
 * One tier's decision for a call. `edge` pushes a CALLS edge with the tier's
 * confidence; `drop` consumes the call without an edge (noise / ambiguous-
 * noise). Returning `null` lets the next tier try.
 */
type TierOutcome =
    | { kind: 'edge'; target: string; confidence: number; statsKey: StatsKey; alternatives?: string[] }
    | { kind: 'drop'; statsKey: StatsKey }
    | null;

type Tier = (call: RawCallSite, ctx: ResolverContext) => TierOutcome;

/**
 * Receiver-type tier (0.95 single match / 0.90 multi-match).
 *
 * Runs FIRST — before the noise filter — so user-domain calls like
 * `user.update()` aren't dropped when `update` happens to be in a language
 * noise list but `UserService.update` exists in the symbol table. Falls
 * through silently when receiverType is absent or no symbol matches.
 */
const receiverTier: Tier = (call, ctx) => {
    if (!call.receiverType) {
        return null;
    }
    const needle = `::${call.receiverType}.${call.callName}`;
    const all = ctx.symbolTable.lookupGlobal(call.callName);
    const matches = all.filter((q) => q.includes(needle));
    if (matches.length === 1) {
        return { kind: 'edge', target: matches[0], confidence: 0.95, statsKey: 'receiver' };
    }
    if (matches.length > 1) {
        const best = pickClosestCandidate(matches, ctx.fp);
        const alternatives = matches.filter((q) => q !== best).sort();
        return {
            kind: 'edge',
            target: best,
            confidence: 0.9,
            statsKey: 'receiver',
            ...(alternatives.length > 0 ? { alternatives } : {}),
        };
    }
    return null;
};

/** Drop calls whose name is in the language's noise list. */
const noiseTier: Tier = (call, ctx) => {
    const lang = languageOfFile(ctx.fp);
    const noise = lang ? getNoiseFor(lang) : null;
    if (noise?.has(call.callName)) {
        return { kind: 'drop', statsKey: 'noise' };
    }
    return null;
};

/** DI tier — routes `this.field.method()` through diMap when field is bound. */
const diTier: Tier = (call, ctx) => {
    if (!call.diField) {
        return null;
    }
    const resolved = resolveDICall(call.diField, call.callName, ctx.fp, ctx.diMap, ctx.symbolTable);
    if (!resolved) {
        return null;
    }
    return { kind: 'edge', target: resolved.target, confidence: resolved.confidence, statsKey: 'di' };
};

/** Class-aware tier — `self.X()` / `super.X()` routed against enclosing class. */
const classTier: Tier = (call, ctx) => {
    if (!call.resolveInClass) {
        return null;
    }
    const resolved = resolveInClass(call.callName, ctx.fp, call.resolveInClass, ctx.symbolTable);
    if (!resolved) {
        return null;
    }
    return {
        kind: 'edge',
        target: resolved.target,
        confidence: resolved.confidence,
        statsKey: resolved.strategy as StatsKey,
    };
};

/** Final tier — name-based cascade (same → import → unique → ambiguous). */
const cascadeTier: Tier = (call, ctx) => {
    const resolved = resolveByName(call.callName, ctx.fp, ctx.symbolTable, ctx.importMap, ctx.totalIndexedFiles);
    if (resolved === AMBIGUOUS_NOISE_DROP) {
        return { kind: 'drop', statsKey: 'ambiguousNoise' };
    }
    if (!resolved) {
        return null;
    }
    return {
        kind: 'edge',
        target: resolved.target,
        confidence: resolved.confidence,
        statsKey: resolved.strategy as StatsKey,
        ...(resolved.alternatives && resolved.alternatives.length > 0 ? { alternatives: resolved.alternatives } : {}),
    };
};

/**
 * Tier order — top is highest priority. Adding a new tier means adding one
 * function above and inserting it here; no surgery on the main loop.
 */
const TIERS: ReadonlyArray<{ name: string; tier: Tier }> = [
    { name: 'receiver', tier: receiverTier },
    { name: 'noise', tier: noiseTier },
    { name: 'di', tier: diTier },
    { name: 'class', tier: classTier },
    { name: 'cascade', tier: cascadeTier },
];

// ── Batch resolution (pure, no I/O) ──

/**
 * Resolve all raw call sites via the tier pipeline (`TIERS`).
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
    const stats: CallResolverStats = {
        di: 0,
        same: 0,
        import: 0,
        unique: 0,
        ambiguous: 0,
        noise: 0,
        ambiguousNoise: 0,
        receiver: 0,
    };

    // `totalIndexedFiles` is stable across the entire resolve batch — compute
    // once and thread into the cascade tier to avoid recomputing per call.
    const totalIndexedFiles = symbolTable.totalIndexedFiles();

    for (const call of rawCalls) {
        const ctx: ResolverContext = {
            fp: call.source,
            diMap: diMaps.get(call.source),
            symbolTable,
            importMap,
            totalIndexedFiles,
        };
        for (const { tier } of TIERS) {
            const outcome = tier(call, ctx);
            if (!outcome) {
                continue;
            }
            if (outcome.kind === 'edge') {
                callEdges.push({
                    source: ctx.fp,
                    target: outcome.target,
                    callName: call.callName,
                    line: call.line,
                    confidence: outcome.confidence,
                    ...(outcome.alternatives ? { alternatives: outcome.alternatives } : {}),
                });
            }
            stats[outcome.statsKey]++;
            break;
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
    if (inFile) {
        return { target: inFile, confidence: 0.9, strategy: 'same' };
    }

    // Class might be in another file (imported parent class for super())
    const candidates = symbolTable.lookupGlobal(callName);
    const match = candidates.find((q) => q.includes(`::${className}.${callName}`));
    if (match) {
        return { target: match, confidence: 0.85, strategy: 'import' };
    }

    return null;
}

// ── DI resolution ──

function resolveDICall(
    fieldName: string,
    methodName: string,
    currentFile: string,
    diMap: Map<string, string> | undefined,
    symbolTable: SymbolTable,
): ResolveResult | null {
    if (!diMap?.has(fieldName)) {
        return null;
    }
    const typeName = diMap.get(fieldName)!;

    // 1) Direct type match — pick by proximity so a multi-package monorepo
    //    doesn't silently bind to whichever file was indexed first.
    const direct = symbolTable.lookupGlobal(typeName);
    if (direct.length >= 1) {
        const best = pickClosestCandidate(direct, currentFile);
        const typeFile = best.includes('::') ? best.split('::')[0] : best;
        return {
            target: `${typeFile}::${typeName}.${methodName}`,
            confidence: 0.95,
            strategy: 'di',
        };
    }

    // 2) Language-specific implementation heuristics (e.g. C#/TS `IFoo → Foo`,
    //    Java/Kotlin/Scala/PHP `Foo → FooImpl|DefaultFoo`, Go `Reader → Read`).
    //    Languages without a consistent DI convention (Python/Ruby/Rust/Swift/
    //    Dart/Elixir/C) intentionally don't register a heuristic — we fall
    //    through to `null` and the caller continues its cascade.
    const lang = languageOfFile(currentFile);
    const heuristics = lang ? getDIHeuristicsFor(lang) : null;
    if (heuristics) {
        for (const implName of heuristics(typeName)) {
            const implCandidates = symbolTable.lookupGlobal(implName);
            if (implCandidates.length >= 1) {
                const best = pickClosestCandidate(implCandidates, currentFile);
                const implFile = best.includes('::') ? best.split('::')[0] : best;
                return {
                    target: `${implFile}::${implName}.${methodName}`,
                    confidence: 0.9,
                    strategy: 'di',
                };
            }
        }
    }

    return null;
}

// ── Name-based resolution (4-tier cascade) ──

/**
 * Internal marker indicating a call was deliberately dropped because it is
 * a generic/noisy name that only resolves ambiguously. Distinct from `null`
 * (unresolved) so stats can count these separately.
 */
const AMBIGUOUS_NOISE_DROP = Symbol('ambiguous_noise_drop');
type ResolveByNameResult = ResolveResult | null | typeof AMBIGUOUS_NOISE_DROP;

function resolveByName(
    callName: string,
    currentFile: string,
    symbolTable: SymbolTable,
    importMap: ImportMap,
    totalIndexedFiles: number,
): ResolveByNameResult {
    // Strategy 1: Same file (0.85)
    const sameFile = symbolTable.lookupExact(currentFile, callName);
    if (sameFile) {
        return { target: sameFile, confidence: 0.85, strategy: 'same' };
    }

    // Strategy 2: Import-resolved (0.70-0.90)
    const importedFrom = importMap.lookup(currentFile, callName);
    if (importedFrom) {
        const targetSym = symbolTable.lookupExact(importedFrom, callName);
        if (targetSym) {
            return { target: targetSym, confidence: 0.9, strategy: 'import' };
        }
        return { target: `${importedFrom}::${callName}`, confidence: 0.7, strategy: 'import' };
    }

    // Strategy 3: Unique global name (0.50, bumped to 0.60 if same package/dir)
    if (symbolTable.isUnique(callName)) {
        const candidates = symbolTable.lookupGlobal(callName);
        const target = candidates[0];
        const candidateFile = target.includes('::') ? target.split('::')[0] : target;
        const callerDir = getDir(currentFile);
        const inSameDir = callerDir.length > 0 && candidateFile.startsWith(`${callerDir}/`);
        return { target, confidence: inSameDir ? 0.6 : 0.5, strategy: 'unique' };
    }

    // Strategy 4: Ambiguous (0.30) — pick closest candidate by directory proximity
    const candidates = symbolTable.lookupGlobal(callName);
    if (candidates.length > 1) {
        // Drop generic/noisy names at the ambiguous tier to avoid polluting
        // the graph with low-signal 0.30 edges across unrelated modules.
        const callerLang = languageOfFile(currentFile);
        const callerNoise = callerLang ? getNoiseFor(callerLang) : null;
        if (callerNoise?.has(callName) || isCodebaseAmbiguous(callName, symbolTable, totalIndexedFiles)) {
            return AMBIGUOUS_NOISE_DROP;
        }
        const best = pickClosestCandidate(candidates, currentFile);
        // `lookupGlobal` returns candidates in insertion (filesystem traversal)
        // order, which isn't stable across OSes or re-indexes. Sort here so the
        // `alternatives` array is deterministic — graph snapshots stay stable
        // and LLM prompts don't churn between runs.
        const alternatives = candidates.filter((c) => c !== best).sort();
        return { target: best, confidence: 0.3, strategy: 'ambiguous', alternatives };
    }

    return null;
}

/**
 * A name is codebase-ambiguous when it is defined in so many files that
 * proximity-based disambiguation becomes unreliable. Replaces the legacy
 * hardcoded `AMBIGUOUS_NOISE` list with a statistical signal derived from
 * the symbol table — self-tunes per repo.
 *
 * Threshold: max(15 absolute, 2% of total indexed files). Small projects
 * with natural duplication (e.g. 3 `save` methods) aren't over-filtered;
 * large monorepos with 50 `validate` methods still drop them.
 */
function isCodebaseAmbiguous(name: string, symbolTable: SymbolTable, totalFiles: number): boolean {
    const definingFiles = symbolTable.countDefinitions(name);
    const floor = 15;
    const fractional = Math.ceil(totalFiles * 0.02);
    const threshold = Math.max(floor, fractional);
    return definingFiles >= threshold;
}

function getDir(file: string): string {
    const i = file.lastIndexOf('/');
    return i < 0 ? '' : file.substring(0, i);
}

// ── Proximity-based candidate selection ──

/**
 * Pick the candidate whose file path is closest to the caller's file.
 *
 * Preference order:
 *   1. Exact same directory (sibling file)
 *   2. Most shared leading path segments (existing prefix heuristic)
 *
 * Example: caller `src/services/auth.ts` calling `foo()` with candidates
 *   - `src/services/user.ts::foo`
 *   - `src/utils/helpers.ts::foo`
 * Both share the `src/` prefix (depth 1), but `services/user.ts` is a
 * direct sibling of the caller and is preferred.
 */
export function pickClosestCandidate(candidates: string[], callerFile: string): string {
    const callerDir = getDir(callerFile);

    // Tier A: prefer a sibling in the exact same directory
    if (callerDir.length > 0) {
        const sameDirPrefix = `${callerDir}/`;
        for (const candidate of candidates) {
            const candidateFile = candidate.includes('::') ? candidate.split('::')[0] : candidate;
            if (getDir(candidateFile) === callerDir && candidateFile.startsWith(sameDirPrefix)) {
                return candidate;
            }
        }
    }

    // Tier B: fall back to shared-prefix proximity
    const callerParts = callerFile.split('/');
    let best = candidates[0];
    let bestScore = -1;

    for (const candidate of candidates) {
        const candidateFile = candidate.includes('::') ? candidate.split('::')[0] : candidate;
        const parts = candidateFile.split('/');
        let shared = 0;
        for (let i = 0; i < Math.min(callerParts.length, parts.length); i++) {
            if (callerParts[i] === parts[i]) {
                shared++;
            } else {
                break;
            }
        }
        if (shared > bestScore) {
            bestScore = shared;
            best = candidate;
        }
    }

    return best;
}

// ── Name-cascade wrapper (unit-test helper) ──

/**
 * Thin name-cascade wrapper used by resolver unit tests to exercise a single
 * call resolution end-to-end without constructing a full `RawCallSite` batch.
 *
 * **Intentionally limited to the name-based cascade** (noise → same-file →
 * import → unique → ambiguous). It does NOT handle:
 *   - DI resolution (`call.diField`) — that requires a `diMap` argument.
 *   - Class-aware resolution (`call.resolveInClass`) — that requires a class
 *     name bound to the call site.
 *   - Receiver-type resolution (`call.receiverType`) — that requires a
 *     receiver-type map from the parser batch.
 *
 * If you need the full pipeline, use `resolveAllCalls([rawCallSite], ...)`
 * with a complete `RawCallSite`. This wrapper exists ONLY for focused
 * name-cascade tests and is not part of the public library API.
 *
 * @internal
 */
export function resolveCall(
    callName: string,
    currentFile: string,
    symbolTable: SymbolTable,
    importMap: ImportMap,
): { target: string; confidence: number } | null {
    const lang = languageOfFile(currentFile);
    const noise = lang ? getNoiseFor(lang) : null;
    if (noise?.has(callName)) {
        return null;
    }

    const totalIndexedFiles = symbolTable.totalIndexedFiles();
    const result = resolveByName(callName, currentFile, symbolTable, importMap, totalIndexedFiles);
    if (!result || result === AMBIGUOUS_NOISE_DROP) {
        return null;
    }

    return { target: result.target, confidence: result.confidence };
}
