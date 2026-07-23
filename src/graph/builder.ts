import { languageOfFile } from '../languages/language-of-file';
import { log } from '../shared/logger';
import { deriveEdges } from './edges';
import type { GraphData, GraphEdge, GraphNode, ImportEdge, RawCallEdge, RawGraph } from './types';

export function buildGraphData(
    raw: RawGraph,
    callEdges: RawCallEdge[],
    importEdges: ImportEdge[],
    _repoDir: string,
    fileHashes: Map<string, string>,
    symbolTable?: { lookupGlobal(name: string): string[] },
    importMap?: { lookup(file: string, name: string): string | null },
    /**
     * Files known to the resolver but not in `raw` (e.g. baseline graph files
     * passed to `parse` by `context`). The CALLS-edge filter at line ~157
     * drops edges whose target file isn't in `parsedFiles`; without this hook
     * a slice re-parse with baseline-seeded resolution would emit valid
     * 0.95-tier edges that get filtered out because the target file lives
     * outside the slice.
     */
    additionalKnownFiles?: ReadonlySet<string>,
): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Functions -> nodes
    for (const f of raw.functions) {
        nodes.push({
            kind: f.kind,
            ast_kind: f.ast_kind,
            name: f.name,
            qualified_name: f.qualified,
            file_path: f.file,
            line_start: f.line_start,
            line_end: f.line_end,
            language: detectLang(f.file),
            parent_name: f.className || undefined,
            params: f.params || undefined,
            return_type: f.returnType || undefined,
            modifiers: f.modifiers || undefined,
            is_test: false,
            file_hash: fileHashes.get(f.file) || '',
            content_hash: f.content_hash,
            is_exported: f.is_exported || undefined,
            is_async: f.is_async || undefined,
            decorators: f.decorators?.length ? f.decorators : undefined,
            throws: f.throws?.length ? f.throws : undefined,
            complexity: f.complexity,
        });
    }

    // Classes -> nodes
    for (const c of raw.classes) {
        nodes.push({
            kind: 'Class',
            ast_kind: c.ast_kind,
            name: c.name,
            qualified_name: c.qualified,
            file_path: c.file,
            line_start: c.line_start,
            line_end: c.line_end,
            language: detectLang(c.file),
            modifiers: c.modifiers || undefined,
            is_test: false,
            file_hash: fileHashes.get(c.file) || '',
            content_hash: c.content_hash,
            is_exported: c.is_exported || undefined,
            decorators: c.decorators?.length ? c.decorators : undefined,
        });
    }

    // Interfaces -> nodes
    for (const i of raw.interfaces) {
        nodes.push({
            kind: 'Interface',
            ast_kind: i.ast_kind,
            name: i.name,
            qualified_name: i.qualified,
            file_path: i.file,
            line_start: i.line_start,
            line_end: i.line_end,
            language: detectLang(i.file),
            is_test: false,
            file_hash: fileHashes.get(i.file) || '',
            content_hash: i.content_hash,
            is_exported: i.is_exported || undefined,
        });
    }

    // Enums -> nodes
    for (const e of raw.enums) {
        nodes.push({
            kind: 'Enum',
            ast_kind: e.ast_kind,
            name: e.name,
            qualified_name: e.qualified,
            file_path: e.file,
            line_start: e.line_start,
            line_end: e.line_end,
            language: detectLang(e.file),
            is_test: false,
            file_hash: fileHashes.get(e.file) || '',
            content_hash: e.content_hash,
            is_exported: e.is_exported || undefined,
        });
    }

    // Tests -> nodes
    for (const t of raw.tests) {
        nodes.push({
            kind: 'Test',
            ast_kind: t.ast_kind,
            name: t.name,
            qualified_name: t.qualified,
            file_path: t.file,
            line_start: t.line_start,
            line_end: t.line_end,
            language: detectLang(t.file),
            is_test: true,
            file_hash: fileHashes.get(t.file) || '',
            content_hash: t.content_hash,
        });
    }

    // Build a set of all parsed file paths for validation (filter external targets)
    //
    // Deliberately keyed on symbol-bearing collections only. A CALLS edge whose
    // target file declares no symbol cannot name a real node, so dropping it is
    // correct — emitting it would put a dangling `barrel.ts::foo` in the graph.
    //
    // The cost of that correctness is silence: when barrel following breaks, an
    // import stays pointed at the (symbol-less) barrel and every edge through it
    // vanishes here with no signal. That is exactly how the TS/JS re-export key
    // mismatch survived. `symbolLessTargets` below turns the drop into a warning
    // so the next such regression is visible instead of silent.
    const parsedFiles = new Set<string>();
    for (const f of raw.functions) {
        parsedFiles.add(f.file);
    }
    for (const c of raw.classes) {
        parsedFiles.add(c.file);
    }
    for (const i of raw.interfaces) {
        parsedFiles.add(i.file);
    }
    for (const e of raw.enums) {
        parsedFiles.add(e.file);
    }
    for (const t of raw.tests) {
        parsedFiles.add(t.file);
    }

    // Files parsed from the repo that declare no symbol (pure barrels/re-export
    // hubs). A CALLS edge targeting one of these is a resolution failure, not an
    // external package — distinguish the two so the drop can be reported.
    const symbolLessRepoFiles = new Set<string>();
    for (const imp of raw.imports) {
        if (!parsedFiles.has(imp.file)) {
            symbolLessRepoFiles.add(imp.file);
        }
    }
    for (const re of raw.reExports) {
        if (!parsedFiles.has(re.file)) {
            symbolLessRepoFiles.add(re.file);
        }
    }
    const droppedToSymbolLess = new Map<string, number>();
    if (additionalKnownFiles) {
        for (const f of additionalKnownFiles) {
            parsedFiles.add(f);
        }
    }

    // Build file→functions index to resolve caller from line number
    const functionsByFile = new Map<string, Array<{ qualified_name: string; line_start: number; line_end: number }>>();
    for (const node of nodes) {
        if (node.kind === 'Class' || node.kind === 'Interface' || node.kind === 'Enum') {
            continue;
        }
        const entry = { qualified_name: node.qualified_name, line_start: node.line_start, line_end: node.line_end };
        const list = functionsByFile.get(node.file_path);
        if (list) {
            list.push(entry);
        } else {
            functionsByFile.set(node.file_path, [entry]);
        }
    }
    // Sort descending by line_start so inner/nested functions match first
    for (const list of functionsByFile.values()) {
        list.sort((a, b) => b.line_start - a.line_start);
    }

    // Class → its constructor node(s). A `new X()` call resolves to the CLASS
    // node (`file::X`), but the constructor's *body* calls hang off a separate
    // constructor node (`file::X.X.constructor`). Without joining them, a
    // reverse blast-radius walk from something the constructor calls stops at
    // the constructor and never reaches the instantiator. We add a parallel
    // CALLS edge from the caller to the constructor so instantiators are
    // threaded into the constructor body's impact set. The class edge is kept
    // (it still records the instantiation/type dependency). Languages with
    // overloaded constructors get one entry per overload — `new X(args)` can't
    // be disambiguated to a single overload here, so we connect to all.
    const classConstructors = new Map<string, string[]>();
    for (const node of nodes) {
        if (!node.parent_name || !isConstructorNode(node)) {
            continue;
        }
        const classQn = `${node.file_path}::${node.parent_name}`;
        const list = classConstructors.get(classQn);
        if (list) {
            list.push(node.qualified_name);
        } else {
            classConstructors.set(classQn, [node.qualified_name]);
        }
    }

    // CALLS edges — resolve caller function from call line number
    for (const ce of callEdges) {
        // Skip calls to external packages (target file not in repo)
        const targetFile = ce.target.split('::')[0];
        if (targetFile && !parsedFiles.has(targetFile)) {
            // In-repo but symbol-less means barrel following failed upstream and
            // the import still points at the hub. The edge is unusable either
            // way, but unlike an external package this is a bug — count it.
            if (symbolLessRepoFiles.has(targetFile)) {
                droppedToSymbolLess.set(targetFile, (droppedToSymbolLess.get(targetFile) ?? 0) + 1);
            }
            continue;
        }

        const sourceFile = ce.source.includes('::') ? ce.source.split('::')[0] : ce.source;
        let sourceQualified: string;

        if (ce.source.includes('::')) {
            sourceQualified = ce.source;
        } else {
            // Find the innermost function containing this call line
            const fns = functionsByFile.get(ce.source);
            let resolved: string | undefined;
            if (fns) {
                for (const fn of fns) {
                    if (ce.line >= fn.line_start && ce.line <= fn.line_end) {
                        resolved = fn.qualified_name;
                        break;
                    }
                }
            }
            if (!resolved) {
                continue; // Skip top-level calls with no enclosing function
            }
            sourceQualified = resolved;
        }

        edges.push({
            kind: 'CALLS',
            source_qualified: sourceQualified,
            target_qualified: ce.target,
            file_path: sourceFile,
            line: ce.line,
            confidence: ce.confidence,
            ...(ce.tier ? { tier: ce.tier } : {}),
            ...(ce.alternatives && ce.alternatives.length > 0 ? { alternatives: ce.alternatives } : {}),
        });

        // Instantiation: the call resolved to a class node that owns a
        // constructor. Thread the caller into the constructor body's impact
        // set with a parallel CALLS edge (see classConstructors above).
        const constructors = classConstructors.get(ce.target);
        if (constructors) {
            for (const ctorQn of constructors) {
                if (ctorQn === sourceQualified) {
                    continue; // a constructor instantiating its own class — skip self-edge
                }
                // No `tier`: this is a derived edge, not a resolver decision.
                // tier_distribution counts only tiered CALLS edges (see
                // mergeTierDistribution), so leaving it off keeps the parse and
                // update tier accounting consistent.
                edges.push({
                    kind: 'CALLS',
                    source_qualified: sourceQualified,
                    target_qualified: ctorQn,
                    file_path: sourceFile,
                    line: ce.line,
                    confidence: ce.confidence,
                });
            }
        }
    }

    // Event coupling (heuristic) — pair emit sites to listeners by exact channel
    // name. The callee (`emit`/`on`) is generic noise the static resolver drops,
    // and the real coupling lives in the literal channel string, which no
    // name-based tier can see. We synthesize a CALLS edge emitter→handler tagged
    // `provenance:'heuristic'` at a low confidence and NO tier, so it enters the
    // blast radius as a labelled guess (recall up) without ever passing for a
    // statically-verified call (precision preserved). Two listener sources:
    //   (a) `@OnEvent('ch')` decorators on a method → the method IS the handler;
    //   (b) `.on('ch', …)` call sites → the enclosing function is the handler.
    const HEURISTIC_EVENT_CONFIDENCE = 0.5;
    const enclosingFn = (file: string, line: number): string | undefined => {
        for (const fn of functionsByFile.get(file) ?? []) {
            if (line >= fn.line_start && line <= fn.line_end) {
                return fn.qualified_name;
            }
        }
        return undefined;
    };

    // channel → emitter function qualified name → emit-site line (for the edge,
    // so a reviewer clicking the caller lands on the `.emit(...)` call).
    const emittersByChannel = new Map<string, Map<string, number>>();
    // channel → handler qualified names
    const handlersByChannel = new Map<string, Set<string>>();
    const addHandler = (channel: string, qn: string) => {
        const set = handlersByChannel.get(channel);
        if (set) {
            set.add(qn);
        } else {
            handlersByChannel.set(channel, new Set([qn]));
        }
    };

    for (const rc of raw.rawCalls) {
        if (!rc.channel || !rc.eventRole) {
            continue;
        }
        const fn = enclosingFn(rc.source, rc.line);
        if (!fn) {
            continue;
        }
        if (rc.eventRole === 'emit') {
            const byFn = emittersByChannel.get(rc.channel);
            if (byFn) {
                if (!byFn.has(fn)) {
                    byFn.set(fn, rc.line);
                }
            } else {
                emittersByChannel.set(rc.channel, new Map([[fn, rc.line]]));
            }
        } else {
            addHandler(rc.channel, fn);
        }
    }

    // Listener handlers declared via decorator: `@OnEvent('ch')` (NestJS),
    // `@OnEvent(['a','b'])`, `@EventPattern('ch')`, `@MessagePattern('ch')`.
    // The decorated method is the real handler — cleaner than an enclosing fn.
    const DECORATOR_CHANNEL_RE = /@(?:OnEvent|EventPattern|MessagePattern)\(\s*(.+?)\s*\)/s;
    const CHANNEL_LITERAL_RE = /['"`]([^'"`]+)['"`]/g;
    for (const node of nodes) {
        if (!node.decorators || node.decorators.length === 0) {
            continue;
        }
        for (const dec of node.decorators) {
            const m = DECORATOR_CHANNEL_RE.exec(dec);
            if (!m) {
                continue;
            }
            for (const lit of m[1].matchAll(CHANNEL_LITERAL_RE)) {
                addHandler(lit[1], node.qualified_name);
            }
        }
    }

    // Synthesize emitter→handler edges for channels present on BOTH sides.
    const seenEventEdge = new Set<string>();
    for (const [channel, emitters] of emittersByChannel) {
        const handlers = handlersByChannel.get(channel);
        if (!handlers) {
            continue;
        }
        for (const [src, emitLine] of emitters) {
            for (const tgt of handlers) {
                if (src === tgt) {
                    continue;
                }
                const key = `${src} ${tgt}`;
                if (seenEventEdge.has(key)) {
                    continue;
                }
                seenEventEdge.add(key);
                edges.push({
                    kind: 'CALLS',
                    source_qualified: src,
                    target_qualified: tgt,
                    file_path: src.split('::')[0],
                    line: emitLine,
                    confidence: HEURISTIC_EVENT_CONFIDENCE,
                    provenance: 'heuristic',
                });
            }
        }
    }

    // IMPORTS edges — only emit resolved imports (skip external/unresolved packages)
    for (const ie of importEdges) {
        if (!ie.resolved) {
            continue;
        }
        edges.push({
            kind: 'IMPORTS',
            source_qualified: ie.source,
            target_qualified: ie.target,
            file_path: ie.source,
            line: ie.line,
        });
    }

    // Derived edges
    const derived = deriveEdges(raw, importEdges, symbolTable, importMap, callEdges);

    // Release raw graph arrays — no longer needed after deriveEdges
    (raw as any).functions = [];
    (raw as any).classes = [];
    (raw as any).interfaces = [];
    (raw as any).enums = [];
    (raw as any).tests = [];
    (raw as any).rawCalls = [];

    for (const e of derived.inherits) {
        edges.push({
            kind: 'INHERITS',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.file || '',
            line: 0,
        });
    }
    for (const e of derived.implements) {
        edges.push({
            kind: 'IMPLEMENTS',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.file || '',
            line: 0,
        });
    }
    for (const e of derived.testedBy) {
        edges.push({
            kind: 'TESTED_BY',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.target || '',
            line: 0,
        });
    }
    for (const e of derived.usesType) {
        edges.push({
            kind: 'USES_TYPE',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.file || '',
            line: 0,
        });
    }
    for (const e of derived.contains) {
        edges.push({
            kind: 'CONTAINS',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.source,
            line: 0,
        });
    }

    if (droppedToSymbolLess.size > 0) {
        let total = 0;
        for (const n of droppedToSymbolLess.values()) {
            total += n;
        }
        log.warn('Dropped CALLS edges targeting in-repo files that declare no symbols', {
            edges: total,
            files: [...droppedToSymbolLess.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([file, count]) => `${file} (${String(count)})`),
            hint: 'Imports still point at a barrel — re-export following did not resolve to the defining file.',
        });
    }

    return { nodes, edges };
}

/**
 * Emits the canonical language key used by registry consumers — extractors,
 * capabilities, noise, receiver types, DI heuristics all key off these exact
 * strings. Delegates to `languageOfFile` so this function and the resolver-side
 * helper stay in lockstep.
 *
 * The JS family uses capitalized keys (`'TypeScript'`, `'Tsx'`, `'JavaScript'`)
 * because that's what the ast-grep `Lang` enum emits at parse time and what
 * the TS/JS extractors register under. Everything else is lowercase.
 *
 * Unrecognized extensions return `'unknown'` (sentinel preserved for
 * back-compat with existing consumers / tests).
 */
function detectLang(file: string): string {
    return languageOfFile(file) ?? 'unknown';
}

/**
 * Reserved constructor method names for languages that model the constructor
 * as an ordinary method (kind 'Method') rather than a dedicated 'Constructor'
 * node. All are language-reserved, so matching them can't collide with a
 * user-defined method. Compared against the final `.`-segment of the node name
 * so TS's `Class.constructor` also matches.
 */
const CONSTRUCTOR_METHOD_NAMES = new Set(['constructor', '__construct', '__init__', 'initialize']);

/** True when a node represents a class constructor (any supported language). */
function isConstructorNode(node: GraphNode): boolean {
    if (node.kind === 'Constructor') {
        return true;
    }
    const last = node.name.split('.').pop() ?? node.name;
    return CONSTRUCTOR_METHOD_NAMES.has(last);
}
