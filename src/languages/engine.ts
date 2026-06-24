import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../graph/types';
import { diScopedKey } from '../shared/qualified-name';
import type { LanguageKey } from './language-of-file';
import type { ReceiverTypeMap } from './receiver-types';
import { createLanguageRegistry } from './registry';
import type { LanguageExtractors } from './spec';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = createLanguageRegistry<LanguageExtractors>();

/**
 * Register a per-language extractor. Typically called at module-load time
 * by each language file (e.g. `registerExtractor('go', goExtractors)`).
 */
export function registerExtractor(lang: LanguageKey, extractor: LanguageExtractors): void {
    registry.register(lang, extractor);
}

/**
 * Check whether a language has a registered extractor.
 */
export function hasExtractor(lang: string): boolean {
    return registry.has(lang);
}

/**
 * Return every language key with a registered extractor, in insertion order.
 * Used by the capability parity test to iterate the canonical extractor
 * registry instead of hardcoding a language list — if a new language is
 * added via `registerExtractor` but the author forgets `registerCapabilities`,
 * the parity test will now catch it automatically.
 */
export function listRegisteredLanguages(): string[] {
    return registry.keys();
}

// ---------------------------------------------------------------------------
// DI heuristics registry
// ---------------------------------------------------------------------------

/**
 * Per-language DI implementation-naming heuristics.
 *
 * Given a DI type name (e.g. `IUserService`, `UserService`, `Reader`), the
 * function returns candidate implementation class names the language's
 * community would conventionally resolve to, in preference order. An empty
 * array means the heuristic had nothing to suggest for this specific type.
 * A language that has no convention at all should NOT register a heuristic —
 * `getDIHeuristicsFor` returns `null` for unregistered languages so callers
 * can distinguish "no convention" from "convention exists but no match".
 */
type DIHeuristicsFn = (typeName: string) => string[];

const DI_REGISTRY = createLanguageRegistry<DIHeuristicsFn>();

export function registerDIHeuristics(language: LanguageKey, fn: DIHeuristicsFn): void {
    DI_REGISTRY.register(language, fn);
}

export function getDIHeuristicsFor(language: string): DIHeuristicsFn | null {
    return DI_REGISTRY.get(language) ?? null;
}

// ---------------------------------------------------------------------------
// Receiver-type inference registry
// ---------------------------------------------------------------------------

/**
 * Per-language receiver-type inference hook. Walks a file's AST and returns
 * a map from call-site location key (`file:line:column`) to the inferred
 * receiver type name (e.g. `'Foo'` for `x.update()` where `x: Foo`).
 *
 * Dynamic languages (Ruby/PHP/Elixir) register a no-op that returns an
 * empty map; static languages implement a scope-local two-pass walk over
 * `let`/`const`/`var` declarations and member-expression call sites.
 */
type ReceiverTypesFn = (root: SgNode, fp: string) => ReceiverTypeMap;

const RECEIVER_TYPES_REGISTRY = createLanguageRegistry<ReceiverTypesFn>();

export function registerReceiverTypes(language: LanguageKey, fn: ReceiverTypesFn): void {
    RECEIVER_TYPES_REGISTRY.register(language, fn);
}

export function getReceiverTypesFor(language: string): ReceiverTypesFn | null {
    return RECEIVER_TYPES_REGISTRY.get(language) ?? null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all structural elements from an AST using the registered extractor
 * for `lang`. Converts the `Extracted*` DTOs into `Raw*` types and pushes
 * them onto the shared `graph`, deduplicating via `seen`.
 *
 * Does nothing (returns silently) when no extractor is registered for the
 * given language.
 */
export function extractAll(root: SgRoot, fp: string, lang: string, seen: Set<string>, graph: RawGraph): void {
    const extractor = registry.get(lang);
    if (!extractor) {
        return;
    }

    const result = extractor.extract(root.root(), fp);

    // ── Classes ──────────────────────────────────────────────────────────
    for (const c of result.classes) {
        const key = `c:${fp}:${c.name}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        graph.classes.push({
            name: c.name,
            file: fp,
            line_start: c.line_start,
            line_end: c.line_end,
            extends: c.extends,
            implements: c.implements,
            ast_kind: c.ast_kind,
            qualified: `${fp}::${c.name}`,
            modifiers: c.modifiers || undefined,
            content_hash: c.content_hash,
            is_exported: c.is_exported || undefined,
            decorators: c.decorators?.length ? c.decorators : undefined,
        });
    }

    // ── Functions / Methods / Constructors ───────────────────────────────
    for (const f of result.functions) {
        const key = `f:${fp}:${f.name}:${f.line_start}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const qualified = f.className ? `${fp}::${f.className}.${f.name}` : `${fp}::${f.name}`;

        // If the function is a test, push to graph.tests as well
        if (f.isTest) {
            const testKey = `t:${fp}:${f.name}:${f.line_start}`;
            if (!seen.has(testKey)) {
                seen.add(testKey);
                graph.tests.push({
                    name: f.name,
                    file: fp,
                    line_start: f.line_start,
                    line_end: f.line_end,
                    ast_kind: f.ast_kind,
                    qualified,
                    content_hash: f.content_hash,
                });
            }
        }

        graph.functions.push({
            name: f.name,
            file: fp,
            line_start: f.line_start,
            line_end: f.line_end,
            params: f.params,
            returnType: f.returnType,
            kind: f.kind,
            ast_kind: f.ast_kind,
            className: f.className,
            qualified,
            modifiers: f.modifiers || undefined,
            content_hash: f.content_hash,
            is_exported: f.is_exported || undefined,
            is_async: f.is_async || undefined,
            decorators: f.decorators?.length ? f.decorators : undefined,
            throws: f.throws?.length ? f.throws : undefined,
            complexity: f.complexity,
        });
    }

    // ── Imports ──────────────────────────────────────────────────────────
    for (const imp of result.imports) {
        graph.imports.push({
            module: imp.module,
            file: fp,
            line: imp.line,
            names: imp.names,
            lang: imp.lang,
        });
    }

    // ── Re-exports ──────────────────────────────────────────────────────
    for (const re of result.reExports) {
        graph.reExports.push({
            module: re.module,
            file: fp,
            line: re.line,
        });
    }

    // ── Interfaces ──────────────────────────────────────────────────────
    for (const iface of result.interfaces) {
        const key = `i:${fp}:${iface.name}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        graph.interfaces.push({
            name: iface.name,
            file: fp,
            line_start: iface.line_start,
            line_end: iface.line_end,
            methods: iface.methods,
            ast_kind: iface.ast_kind,
            qualified: `${fp}::${iface.name}`,
            content_hash: iface.content_hash,
            is_exported: iface.is_exported || undefined,
        });
    }

    // ── Enums ───────────────────────────────────────────────────────────
    for (const en of result.enums) {
        const key = `e:${fp}:${en.name}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        graph.enums.push({
            name: en.name,
            file: fp,
            line_start: en.line_start,
            line_end: en.line_end,
            ast_kind: en.ast_kind,
            qualified: `${fp}::${en.name}`,
            content_hash: en.content_hash,
            is_exported: en.is_exported || undefined,
        });
    }

    // ── Dependency Injection entries ─────────────────────────────────────
    if (result.diEntries.length > 0) {
        let diMap = graph.diMaps.get(fp);
        if (!diMap) {
            diMap = new Map<string, string>();
            graph.diMaps.set(fp, diMap);
        }
        for (const di of result.diEntries) {
            // Bare field key — the file-scoped fallback (unchanged behavior).
            diMap.set(di.fieldName, di.typeName);
            // Per-class key — disambiguates same-named fields across two classes
            // in the same file. Only written when the extractor threads the
            // declaring class; the resolver prefers it when it knows the
            // call's enclosing class.
            if (di.className) {
                diMap.set(diScopedKey(di.className, di.fieldName), di.typeName);
            }
        }
    }

    // ── Module-scope value bindings ──────────────────────────────────────
    // Aggregate per-file `const x = new Foo()` etc. into a global map so the
    // resolver can substitute receiverType for imported names.
    if (result.valueBindings && result.valueBindings.length > 0) {
        let vb = graph.valueBindings.get(fp);
        if (!vb) {
            vb = new Map<string, string>();
            graph.valueBindings.set(fp, vb);
        }
        for (const entry of result.valueBindings) {
            vb.set(entry.name, entry.type);
        }
    }
}

/**
 * Delegate call-site extraction to the registered language extractor.
 * Does nothing when no extractor is registered for the given language.
 */
export function extractCallsFromEngine(root: SgRoot, fp: string, lang: string, calls: RawCallSite[]): void {
    const extractor = registry.get(lang);
    if (!extractor) {
        return;
    }
    extractor.extractCalls(root.root(), fp, calls);
}

/**
 * Run the registered receiver-type inference pass for `lang`, returning the
 * resulting map (or an empty map if no language registered one). The parser
 * batch calls this after `extractCallsFromEngine` and copies matching
 * entries into each call's `receiverType` field.
 */
export function extractReceiverTypesFromEngine(root: SgRoot, fp: string, lang: string): ReceiverTypeMap {
    const fn = RECEIVER_TYPES_REGISTRY.get(lang);
    if (!fn) {
        return new Map();
    }
    return fn(root.root(), fp);
}
