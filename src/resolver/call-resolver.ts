/**
 * Call resolution with 5-tier confidence cascade.
 *
 * Cascade: DI (0.90-0.95) → same-file (0.85) → import-resolved (0.70-0.90)
 *        → unique-name (0.50) → ambiguous (0.30)
 *
 * Pure resolution logic — no file I/O, no parsing.
 * Raw call sites are provided by the batch parser.
 */

import type { RawCallEdge, RawCallSite, RawGraph } from '../graph/types';
import { getDIHeuristicsFor } from '../languages/engine';
import { languageOfFile } from '../languages/language-of-file';
import { getNoiseFor } from '../languages/noise-registry';
import { diScopedKey } from '../shared/qualified-name';
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
    /**
     * Class hierarchy: subclass type-name → array of parent type-names (extends
     * + implements). Used by the receiver tier as a fallback: if `Foo.method`
     * isn't in the symbol table but Foo extends Bar and `Bar.method` is, resolve
     * to `Bar.method` at 0.85 confidence (inheritance is precise but less direct
     * than instance-on-actual-type).
     */
    classHierarchy: Map<string, string[]>;
    /**
     * Qualified-name → return-type map. Used by the chain pass and by the
     * receiver tier when resolving deferred `@CALLEE:foo` receiver types
     * (intra/cross-file factory pattern: `const x = factory(); x.method()`).
     */
    returnTypes: Map<string, string>;
    /**
     * Per-file module-level value bindings: `file -> Map<varName, type>`.
     * Used by the receiver tier when resolving deferred `@IMPORT:varName`
     * markers — caller imports `db`, source file declares
     * `export const db = new Database()`, resolver substitutes 'Database'.
     */
    valueBindings: Map<string, Map<string, string>>;
}

/**
 * Marker prefix written into `RawCallSite.receiverType` when the type can't
 * be determined at extraction time but the receiver was assigned a function
 * call. The resolver looks up the callee's qualified name + return type at
 * resolve time (when cross-file symbol info is available) and substitutes
 * the actual type before tier processing.
 */
const DEFERRED_CALLEE_PREFIX = '@CALLEE:';

/**
 * Marker prefix for cross-file value-binding lookup. Written when the
 * receiver is an unbound lowercase identifier that's likely imported.
 * Resolver: `importMap.lookup(file, name) → sourceFile`,
 * `valueBindings.get(sourceFile).get(name) → type`.
 */
const DEFERRED_IMPORT_PREFIX = '@IMPORT:';

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
    // Deferred receiver type: `@CALLEE:funcName` was set when the variable
    // came from `const x = funcName()`. Resolve funcName's return type now
    // (cross-file symbol info is available at this stage) and substitute it.
    if (call.receiverType.startsWith(DEFERRED_CALLEE_PREFIX)) {
        const calleeName = call.receiverType.slice(DEFERRED_CALLEE_PREFIX.length);
        const resolved = resolveDeferredCallee(calleeName, ctx);
        if (!resolved) {
            return null;
        }
        call.receiverType = resolved;
    }
    // Cross-file imported value: `@IMPORT:db` was set when the receiver was
    // an unbound identifier (likely an import). Resolve via importMap →
    // source file's valueBindings. If the source file's binding is itself a
    // `@CALLEE:` marker, follow that chain too.
    if (call.receiverType.startsWith(DEFERRED_IMPORT_PREFIX)) {
        const varName = call.receiverType.slice(DEFERRED_IMPORT_PREFIX.length);
        const resolved = resolveDeferredImport(varName, ctx);
        if (!resolved) {
            return null;
        }
        call.receiverType = resolved;
    }
    const all = ctx.symbolTable.lookupGlobal(call.callName);
    const directNeedle = `::${call.receiverType}.${call.callName}`;
    const direct = all.filter((q) => q.includes(directNeedle));
    if (direct.length === 1) {
        return { kind: 'edge', target: direct[0], confidence: 0.95, statsKey: 'receiver' };
    }
    if (direct.length > 1) {
        const best = pickClosestCandidate(direct, ctx.fp);
        const alternatives = direct.filter((q) => q !== best).sort();
        return {
            kind: 'edge',
            target: best,
            confidence: 0.9,
            statsKey: 'receiver',
            ...(alternatives.length > 0 ? { alternatives } : {}),
        };
    }
    // Inheritance fallback — `Foo.method` not found, but Foo extends Bar (or
    // implements an interface with `method`). Walk up the hierarchy with cycle
    // protection. Confidence drops to 0.85 to reflect indirect resolution.
    const inheritedTarget = lookupViaInheritance(call.receiverType, call.callName, all, ctx.classHierarchy);
    if (inheritedTarget) {
        return { kind: 'edge', target: inheritedTarget, confidence: 0.85, statsKey: 'receiver' };
    }
    return null;
};

/**
 * Resolve a deferred `@CALLEE:funcName` receiver type to a concrete type by
 * looking up the function in the symbol table (same file → import → unique
 * name) and consulting the global return-types map. Returns the stripped
 * return type, or `undefined` if the callee can't be located or has no
 * declared return type.
 */
function resolveDeferredCallee(calleeName: string, ctx: ResolverContext): string | undefined {
    let qualified: string | undefined;
    const sameFile = ctx.symbolTable.lookupExact(ctx.fp, calleeName);
    if (sameFile) {
        qualified = sameFile;
    } else {
        const importedFrom = ctx.importMap.lookup(ctx.fp, calleeName);
        if (importedFrom) {
            qualified = ctx.symbolTable.lookupExact(importedFrom, calleeName) ?? `${importedFrom}::${calleeName}`;
        }
    }
    if (!qualified) {
        // Fall back to a unique global definition.
        const globals = ctx.symbolTable.lookupGlobal(calleeName);
        if (globals.length === 1) {
            qualified = globals[0];
        }
    }
    if (!qualified) {
        return undefined;
    }
    const returnType = ctx.returnTypes.get(qualified);
    if (!returnType) {
        return undefined;
    }
    return stripGenerics(returnType);
}

/**
 * Resolve a deferred `@IMPORT:varName` receiver type by consulting the
 * importMap (caller file → source file) and the global valueBindings map
 * (source file → varName → type). Falls through gracefully when the
 * receiver isn't actually imported, or when the source file has no
 * binding for that name.
 *
 * If the source binding itself is a `@CALLEE:funcName` (factory pattern
 * exported and re-imported), follows the callee chain as well — at most
 * one hop to bound work.
 */
function resolveDeferredImport(varName: string, ctx: ResolverContext): string | undefined {
    const sourceFile = ctx.importMap.lookup(ctx.fp, varName);
    if (!sourceFile) {
        return undefined;
    }
    const sourceBindings = ctx.valueBindings.get(sourceFile);
    if (!sourceBindings) {
        return undefined;
    }
    const binding = sourceBindings.get(varName);
    if (!binding) {
        return undefined;
    }
    // The binding might itself be deferred (`@CALLEE:factory`) — follow once.
    if (binding.startsWith(DEFERRED_CALLEE_PREFIX)) {
        const calleeName = binding.slice(DEFERRED_CALLEE_PREFIX.length);
        // Resolve the callee in the SOURCE file's context (where it was declared).
        const sourceCtx: ResolverContext = { ...ctx, fp: sourceFile };
        return resolveDeferredCallee(calleeName, sourceCtx);
    }
    // Avoid infinite loops if a binding is `@IMPORT:` (re-export of imported).
    if (binding.startsWith(DEFERRED_IMPORT_PREFIX)) {
        return undefined;
    }
    return binding;
}

/**
 * Walk up the class hierarchy from `typeName`, returning the first qualified
 * symbol where `<parent>.<callName>` is in the symbol table. Visits each
 * ancestor at most once. Caps depth at 8 to bound work — deeper hierarchies
 * are rare and pathological.
 */
function lookupViaInheritance(
    typeName: string,
    callName: string,
    candidates: string[],
    classHierarchy: Map<string, string[]>,
): string | undefined {
    const visited = new Set<string>([typeName]);
    let frontier = classHierarchy.get(typeName) ?? [];
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
        const next: string[] = [];
        for (const parent of frontier) {
            if (visited.has(parent)) {
                continue;
            }
            visited.add(parent);
            const needle = `::${parent}.${callName}`;
            const hit = candidates.find((q) => q.includes(needle));
            if (hit) {
                return hit;
            }
            const parents = classHierarchy.get(parent);
            if (parents) {
                next.push(...parents);
            }
        }
        frontier = next;
    }
    return undefined;
}

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
    const resolved = resolveDICall(
        call.diField,
        call.callName,
        ctx.fp,
        ctx.diMap,
        ctx.symbolTable,
        ctx.classHierarchy,
        call.diClass,
    );
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
    const resolved = resolveInClass(call.callName, ctx.fp, call.resolveInClass, ctx.symbolTable, ctx.classHierarchy);
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
    // DI runs BEFORE the noise filter, like the receiver tier: a `this.field.method()`
    // call whose field has a known injected type resolves to `Type.method` even when
    // `method` is a generic name in the noise list (`get`/`set`/`has`/…). Otherwise
    // noise would drop a structurally-resolvable DI call. A DI call whose field type
    // is unknown falls through to `noise` below and is still dropped.
    { name: 'di', tier: diTier },
    { name: 'noise', tier: noiseTier },
    { name: 'class', tier: classTier },
    { name: 'cascade', tier: cascadeTier },
];

/**
 * Run the tier pipeline against one call. Extracted from the main loop so the
 * chain pass can re-resolve a single call after its receiverType is filled in.
 */
function runTiers(call: RawCallSite, ctx: ResolverContext): TierOutcome {
    for (const { tier } of TIERS) {
        const outcome = tier(call, ctx);
        if (outcome) {
            return outcome;
        }
    }
    return null;
}

// ── Method-chain receiver inference ──

/**
 * Strip generic / collection wrappers from a return-type string for the
 * chain receiver-type tier. Best-effort — covers the common cases
 * (`Promise<User>` → `User`, `User[]` → `User`, `List<User>` → `User`,
 * `Optional[User]` → `User`). Multi-arg generics keep the first parameter.
 */
/**
 * Method names that conventionally return the type they're called on (the
 * singleton / factory / shared-instance pattern). When the chain pass sees
 * `Foo.getInstance().method()` and the inner `getInstance` has no explicit
 * return type in the symbol table, treat the receiver type as the propagated
 * type. Cross-language: Java `getInstance`, Swift `shared`, Kotlin `Default`,
 * TS `getInstance` / `default`, C# `Instance`.
 */
const SINGLETON_FACTORIES: ReadonlySet<string> = new Set([
    'getInstance',
    'instance',
    'Instance',
    'default',
    'Default',
    'getDefault',
    'shared',
    'Shared',
    'newInstance',
    'create',
    'of',
]);

function stripGenerics(returnType: string): string {
    let t = returnType.trim();
    // Array brackets (TS / Java / C# / Rust slices in some forms).
    t = t.replace(/\[\]$/, '');
    // Outer wrapper `Wrapper<Inner, ...>` or `Wrapper[Inner, ...]` (Python).
    const m = t.match(/^[A-Za-z_][\w.]*\s*[<[]\s*([^,>\]]+)/);
    if (m) {
        return stripGenerics(m[1].trim());
    }
    return t;
}

// ── Batch resolution (pure, no I/O) ──

/**
 * Resolve all raw call sites via the tier pipeline (`TIERS`).
 *
 * Accepts pre-extracted RawCallSite[] from the batch parser.
 * No file reads, no parseAsync — pure iteration + lookup.
 *
 * When `returnTypes` is provided (qualified-name → returnType map built
 * from the raw graph's functions), runs a second pass for chained calls:
 * `x.a().b()`. The outer call's `chainedFromLine`/`chainedFromColumn`
 * pinpoint the inner call; the resolver looks up the inner's resolved
 * target's return type, strips generics, and re-runs TIERS for the outer
 * with `receiverType` set — typically promoting the outer from
 * ambiguous/unique to the receiver tier (0.95 / 0.90).
 */
export function resolveAllCalls(
    rawCalls: RawCallSite[],
    diMaps: Map<string, Map<string, string>>,
    symbolTable: SymbolTable,
    importMap: ImportMap,
    returnTypes?: Map<string, string>,
    classHierarchy?: Map<string, string[]>,
    valueBindings?: Map<string, Map<string, string>>,
): ResolveAllResult {
    const hierarchy = classHierarchy ?? new Map<string, string[]>();
    const returnTypeMap = returnTypes ?? new Map<string, string>();
    const valueBindingsMap = valueBindings ?? new Map<string, Map<string, string>>();
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

    // Resolve every call once, keeping outcomes parallel-arrayed with
    // rawCalls so the chain pass can reach back into them.
    const outcomes: (TierOutcome | null)[] = new Array(rawCalls.length);
    for (let i = 0; i < rawCalls.length; i++) {
        const call = rawCalls[i];
        const ctx: ResolverContext = {
            fp: call.source,
            diMap: diMaps.get(call.source),
            symbolTable,
            importMap,
            totalIndexedFiles,
            classHierarchy: hierarchy,
            returnTypes: returnTypeMap,
            valueBindings: valueBindingsMap,
        };
        outcomes[i] = runTiers(call, ctx);
    }

    // Chain pass: for each outer call with a known inner, propagate the
    // inner's resolved-target return type as the outer's receiverType, then
    // re-run TIERS. Runs whenever there's a return-type map OR rawCalls
    // contain candidates whose inner could trigger the singleton heuristic
    // (no return-type entry needed for that path).
    {
        const callIndexByLoc = new Map<string, number>();
        for (let i = 0; i < rawCalls.length; i++) {
            const c = rawCalls[i];
            callIndexByLoc.set(`${c.source}:${c.line}:${c.column ?? -1}`, i);
        }
        for (let i = 0; i < rawCalls.length; i++) {
            const call = rawCalls[i];
            if (call.chainedFromLine === undefined) {
                continue;
            }
            const current = outcomes[i];
            if (current?.kind === 'edge' && current.statsKey === 'receiver') {
                continue;
            }
            const innerKey = `${call.source}:${call.chainedFromLine}:${call.chainedFromColumn ?? -1}`;
            const innerIdx = callIndexByLoc.get(innerKey);
            if (innerIdx === undefined) {
                continue;
            }
            const innerOutcome = outcomes[innerIdx];
            if (!innerOutcome || innerOutcome.kind !== 'edge') {
                continue;
            }
            let stripped: string | undefined;
            const returnType = returnTypeMap.get(innerOutcome.target);
            if (returnType) {
                stripped = stripGenerics(returnType);
            }
            // Singleton/factory heuristic: `Foo.getInstance().method()` —
            // when the inner call's name is a known self-returning factory and
            // its receiverType is set, propagate that type. Catches cases where
            // the method body has an inferred return type the parser can't see.
            if (!stripped && rawCalls[innerIdx].receiverType && SINGLETON_FACTORIES.has(rawCalls[innerIdx].callName)) {
                stripped = rawCalls[innerIdx].receiverType;
            }
            if (!stripped) {
                continue;
            }
            // Mutate the call to carry the inferred receiverType and re-run
            // tiers. The receiver tier matches `::Type.method` qualified names.
            call.receiverType = stripped;
            const ctx: ResolverContext = {
                fp: call.source,
                diMap: diMaps.get(call.source),
                symbolTable,
                importMap,
                totalIndexedFiles,
                classHierarchy: hierarchy,
                returnTypes: returnTypeMap,
                valueBindings: valueBindingsMap,
            };
            const upgraded = runTiers(call, ctx);
            if (upgraded?.kind === 'edge' && upgraded.statsKey === 'receiver') {
                outcomes[i] = upgraded;
            }
        }
    }

    // Materialize edges + stats from the final outcomes.
    const callEdges: RawCallEdge[] = [];
    for (let i = 0; i < rawCalls.length; i++) {
        const outcome = outcomes[i];
        if (!outcome) {
            continue;
        }
        if (outcome.kind === 'edge') {
            const call = rawCalls[i];
            // `statsKey` for edge outcomes is one of the EdgeTier strings —
            // 'noise'/'ambiguousNoise' are drop-only and never reach this branch.
            callEdges.push({
                source: call.source,
                target: outcome.target,
                callName: call.callName,
                line: call.line,
                confidence: outcome.confidence,
                tier: outcome.statsKey as RawCallEdge['tier'],
                ...(outcome.alternatives ? { alternatives: outcome.alternatives } : {}),
            });
        }
        stats[outcome.statsKey]++;
    }

    return { callEdges, stats };
}

// ── Class-aware resolution (self./super.) ──

function resolveInClass(
    callName: string,
    currentFile: string,
    className: string,
    symbolTable: SymbolTable,
    classHierarchy: Map<string, string[]>,
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

    // Inherited method: `this.method()` where `method` is declared on a base
    // class, not the enclosing subclass. Walk the hierarchy like the receiver
    // and DI tiers — otherwise a subclass calling an inherited method loses the
    // edge, and the base method's blast radius never reaches this call site.
    const inherited = lookupViaInheritance(className, callName, candidates, classHierarchy);
    if (inherited) {
        return { target: inherited, confidence: 0.85, strategy: 'same' };
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
    classHierarchy: Map<string, string[]>,
    diClass?: string,
): ResolveResult | null {
    if (!diMap) {
        return null;
    }
    // Prefer the per-class binding (`A#repo`) so two classes in the same file
    // injecting different types into a same-named field resolve correctly;
    // fall back to the bare field key when the call's class is unknown.
    const typeName = (diClass ? diMap.get(diScopedKey(diClass, fieldName)) : undefined) ?? diMap.get(fieldName);
    if (typeName === undefined) {
        return null;
    }

    // 1) Direct type match — pick by proximity so a multi-package monorepo
    //    doesn't silently bind to whichever file was indexed first.
    const direct = symbolTable.lookupGlobal(typeName);
    if (direct.length >= 1) {
        const best = pickClosestCandidate(direct, currentFile);
        const typeFile = best.includes('::') ? best.split('::')[0] : best;
        const own = `${typeFile}::${typeName}.${methodName}`;
        // Only claim `Type.method` if that method is actually declared on the
        // type. For an inherited method (Type extends Base, Base defines it) walk
        // up the hierarchy to the base that owns it — mirroring the receiver
        // tier. Otherwise we emit a phantom `Subclass.method` node, which breaks
        // the blast radius INTO the real base method (a change to Base.method
        // fails to reach this DI call site).
        const methodCandidates = symbolTable.lookupGlobal(methodName);
        if (methodCandidates.includes(own)) {
            return { target: own, confidence: 0.95, strategy: 'di' };
        }
        const inherited = lookupViaInheritance(typeName, methodName, methodCandidates, classHierarchy);
        if (inherited) {
            return { target: inherited, confidence: 0.9, strategy: 'di' };
        }
        // Method isn't in the symbol table at all (e.g. declared in an unparsed
        // dependency) — keep the direct guess rather than dropping the edge.
        return { target: own, confidence: 0.95, strategy: 'di' };
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
    // Strategy 1: Import-resolved (0.70-0.90).
    // Checked before same-file: an imported name is the lexical binding, so a
    // same-file symbol of the same spelling can only be a method (e.g. an
    // object-literal shorthand method) that an unqualified `name()` never
    // targets. In languages where an unqualified call CAN bind a same-class
    // method (C#, C++, Ruby, Elixir — implicit `this`/self) there is no
    // competing import, so same-file still wins in Strategy 2 below.
    const importedFrom = importMap.lookup(currentFile, callName);
    if (importedFrom) {
        const targetSym = symbolTable.lookupExact(importedFrom, callName);
        if (targetSym) {
            return { target: targetSym, confidence: 0.9, strategy: 'import' };
        }
        return { target: `${importedFrom}::${callName}`, confidence: 0.7, strategy: 'import' };
    }

    // Strategy 2: Same file (0.85)
    const sameFile = symbolTable.lookupExact(currentFile, callName);
    if (sameFile) {
        return { target: sameFile, confidence: 0.85, strategy: 'same' };
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

/**
 * Resolve every call in a `RawGraph`, deriving the receiver-tier inputs from the
 * graph itself.
 *
 * Prefer this over calling {@link resolveAllCalls} directly. Its last three
 * parameters (`returnTypes`, `classHierarchy`, `valueBindings`) are optional and
 * default to empty maps, so omitting them does not fail — it silently disables
 * the 0.95 receiver tier's inheritance fallback, the chained-call pass, and
 * `@IMPORT:`/`@CALLEE:` deferred resolution, and the only trace is a tier
 * distribution reporting `receiver: 0`. `parse` passed all seven arguments;
 * `analyze`, `diff` and `update` passed four, so three of the four commands ran
 * a degraded resolver against the same repo and produced different edges.
 *
 * Taking the whole `RawGraph` removes the footgun: there is nothing left for a
 * caller to forget.
 */
export function resolveCallsForGraph(
    rawGraph: RawGraph,
    symbolTable: SymbolTable,
    importMap: ImportMap,
): ResolveAllResult {
    // Qualified name → return type, so the chain pass can propagate
    // `Foo.method() → ReturnType` to the outer call in `x.method().chained()`.
    const returnTypes = new Map<string, string>();
    for (const f of rawGraph.functions) {
        if (f.returnType) {
            returnTypes.set(f.qualified, f.returnType);
        }
    }

    // Subclass → [parents], from `extends`/`implements`. The receiver tier walks
    // this when a method isn't on the immediate type but is on an ancestor.
    const classHierarchy = new Map<string, string[]>();
    for (const c of rawGraph.classes) {
        const parents: string[] = [];
        if (c.extends) {
            parents.push(c.extends);
        }
        if (c.implements?.length) {
            parents.push(...c.implements);
        }
        if (parents.length > 0) {
            const existing = classHierarchy.get(c.name);
            classHierarchy.set(c.name, existing ? [...existing, ...parents] : parents);
        }
    }

    return resolveAllCalls(
        rawGraph.rawCalls,
        rawGraph.diMaps,
        symbolTable,
        importMap,
        returnTypes,
        classHierarchy,
        rawGraph.valueBindings,
    );
}
