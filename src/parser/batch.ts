import type { SgRoot } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { extname, relative } from 'path';
import type { ParseBatchResult, RawCallSite, RawGraph } from '../graph/types';
import { extractReceiverTypesFromEngine } from '../languages/engine';
import { locationKey } from '../languages/receiver-types';
import { log } from '../shared/logger';
import { extractCallsFromFile, extractFromFile } from './extractor';
import { getLanguage, getLanguageName } from './languages';

const INITIAL_BATCH = 50;
const MEMORY_THRESHOLD_RATIO = 0.7;
const GROW_AFTER_IDLE_BATCHES = 3;

export type BatchAction = 'shrink' | 'grow' | 'hold';

/**
 * Pure helper: decide the next batch size given current RSS and idle streak.
 * Extracted so it can be unit-tested without driving real memory pressure.
 *
 * Three actions:
 * - `shrink`: RSS over threshold AND batchSize > floor → halve (floor=1).
 * - `grow`: RSS below threshold AND been idle >= GROW_AFTER_IDLE_BATCHES AND
 *   batchSize < initial → double (capped at initial). Lets the reducer recover
 *   from a transient spike instead of staying at floor forever.
 * - `hold`: no change. Returned when we're at floor under sustained pressure,
 *   at initial size, or within the idle-grace window.
 *
 * The caller uses the action to decide whether to log / yield / trigger GC.
 * `hold` specifically means "don't pay the yield+gc cost" — that was the
 * regression that turned a 5-min parse into 12-min on discourse.
 */
export function computeNextBatchSize(
    current: number,
    rssBytes: number,
    maxBytes: number,
    threshold: number,
    idleBatches: number,
    initial: number,
): { batchSize: number; action: BatchAction } {
    const underPressure = rssBytes > maxBytes * threshold;
    if (underPressure) {
        const next = Math.max(1, Math.floor(current / 2));
        if (next < current) {
            return { batchSize: next, action: 'shrink' };
        }
        return { batchSize: current, action: 'hold' };
    }
    if (current < initial && idleBatches >= GROW_AFTER_IDLE_BATCHES) {
        const next = Math.min(initial, current * 2);
        return { batchSize: next, action: 'grow' };
    }
    return { batchSize: current, action: 'hold' };
}

export async function parseBatch(
    files: string[],
    repoRoot: string,
    options?: { skipTests?: boolean; maxMemoryMB?: number },
): Promise<ParseBatchResult> {
    const graph: RawGraph = {
        functions: [],
        classes: [],
        interfaces: [],
        enums: [],
        tests: [],
        imports: [],
        reExports: [],
        rawCalls: [],
        diMaps: new Map(),
    };
    const seen = new Set<string>();
    let parseErrors = 0;
    let extractErrors = 0;
    let batchSize = INITIAL_BATCH;
    let idleBatches = 0;
    const maxMemBytes = (options?.maxMemoryMB ?? 768) * 1024 * 1024;

    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        const promises = batch.map(async (filePath) => {
            const lang = getLanguage(extname(filePath));
            if (!lang) {
                return;
            }

            let source: string;
            try {
                source = readFileSync(filePath, 'utf-8');
            } catch (err) {
                log.warn('Failed to read file', { file: filePath, error: String(err) });
                parseErrors++;
                return;
            }

            let root: SgRoot;
            try {
                root = await parseAsync(lang, source);
            } catch (err) {
                log.warn('Failed to parse file', { file: filePath, error: String(err) });
                parseErrors++;
                return;
            }

            const fp = relative(repoRoot, filePath);

            try {
                extractFromFile(root, fp, lang, seen, graph);
            } catch (err) {
                log.error('Extraction crashed', { file: fp, error: String(err) });
                extractErrors++;
            }

            try {
                // Extract calls, then attach receiver types before pushing.
                // Noise is NOT filtered here — the resolver applies it AFTER
                // the receiver-type tier so user-domain calls like
                // `user.update()` can resolve to `UserService.update` even
                // when `update` is in the language noise list.
                const rawCalls: RawCallSite[] = [];
                extractCallsFromFile(root, fp, lang, rawCalls);

                // Receiver-type inference pass — returns a map keyed by
                // `${file}:${line}:${column}` for each call site the language
                // extractor could infer a scope-local type for. Dynamic
                // languages (Ruby/PHP/Elixir) return an empty map. We use
                // column when the extractor provides it; otherwise fall back
                // to line-only matching (documented as a known limitation for
                // extractors that don't yet thread column through calls).
                const langStr = typeof lang === 'string' ? lang : getLanguageName(lang);
                const receiverMap = extractReceiverTypesFromEngine(root, fp, langStr);

                for (const call of rawCalls) {
                    if (receiverMap.size > 0) {
                        // Try column-qualified key first, then line-only fallback.
                        const keyed = locationKey(fp, call.line, call.column ?? -1);
                        const lineOnly = locationKey(fp, call.line, -1);
                        const rt = receiverMap.get(keyed) ?? receiverMap.get(lineOnly);
                        if (rt) {
                            call.receiverType = rt;
                        }
                    }
                    graph.rawCalls.push(call);
                }
            } catch (err) {
                log.error('Call extraction crashed', { file: fp, error: String(err) });
                extractErrors++;
            }
        });

        await Promise.all(promises);

        // Dynamic batch sizing. Only pay the yield + gc cost on `shrink` —
        // when `hold` at the floor under sustained pressure, the yield/gc
        // overhead was making a 5-min parse take 12 min on discourse.
        const rss = process.memoryUsage().rss;
        const decision = computeNextBatchSize(
            batchSize,
            rss,
            maxMemBytes,
            MEMORY_THRESHOLD_RATIO,
            idleBatches,
            INITIAL_BATCH,
        );

        if (decision.action === 'shrink') {
            const oldBatch = batchSize;
            batchSize = decision.batchSize;
            idleBatches = 0;
            log.warn('Memory pressure detected, reducing batch size', {
                rssMB: Math.round(rss / 1024 / 1024),
                maxMB: Math.round(maxMemBytes / 1024 / 1024),
                oldBatchSize: oldBatch,
                newBatchSize: batchSize,
            });
            // Yield + optional GC only when we actually shrank. Lets the
            // runtime reclaim freed references before the next (smaller) wave.
            await new Promise<void>((resolve) => setImmediate(resolve));
            const g = (globalThis as { gc?: () => void }).gc;
            if (typeof g === 'function') {
                g();
            }
        } else if (decision.action === 'grow') {
            const oldBatch = batchSize;
            batchSize = decision.batchSize;
            idleBatches = 0;
            log.info('Memory pressure cleared, growing batch size', {
                rssMB: Math.round(rss / 1024 / 1024),
                oldBatchSize: oldBatch,
                newBatchSize: batchSize,
            });
        } else {
            // hold: track idle streak so we can grow back after recovery.
            // Don't log and don't yield — this is the hot path.
            if (rss <= maxMemBytes * MEMORY_THRESHOLD_RATIO) {
                idleBatches++;
            }
        }
    }

    if (options?.skipTests) {
        graph.tests = [];
    }

    return { ...graph, parseErrors, extractErrors };
}
