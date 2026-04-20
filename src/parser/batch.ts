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

/**
 * Pure helper: decide the next batch size given current RSS. Extracted so it
 * can be unit-tested without having to drive real memory pressure.
 *
 * Under pressure we halve the batch size with a floor of 1 (not 5) so that
 * severely constrained runs can fall all the way back to serial processing.
 * Without the floor=1 change, the reducer stalls at 5 and RSS can run away.
 */
export function computeNextBatchSize(
    current: number,
    rssBytes: number,
    maxBytes: number,
    threshold: number,
): { batchSize: number; underPressure: boolean } {
    const underPressure = rssBytes > maxBytes * threshold;
    if (!underPressure) {
        return { batchSize: current, underPressure: false };
    }
    const next = Math.max(1, Math.floor(current / 2));
    return { batchSize: next, underPressure: true };
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

        // Dynamic batch sizing: reduce if memory pressure detected. Only log
        // on actual state changes (batchSize shrinking or pressure clearing)
        // so we don't flood stderr with identical warnings each iteration.
        const rss = process.memoryUsage().rss;
        const decision = computeNextBatchSize(batchSize, rss, maxMemBytes, MEMORY_THRESHOLD_RATIO);
        if (decision.underPressure) {
            const oldBatch = batchSize;
            batchSize = decision.batchSize;
            if (batchSize !== oldBatch) {
                log.warn('Memory pressure detected, reducing batch size', {
                    rssMB: Math.round(rss / 1024 / 1024),
                    maxMB: Math.round(maxMemBytes / 1024 / 1024),
                    oldBatchSize: oldBatch,
                    newBatchSize: batchSize,
                });
            }
            // Yield to the event loop so GC can reclaim freed references
            // before we dispatch the next batch. Without this, the loop
            // immediately schedules the next wave and GC never gets a
            // chance to run between batches.
            await new Promise<void>((resolve) => setImmediate(resolve));
            // Best-effort explicit GC when running with --expose-gc.
            const g = (globalThis as { gc?: () => void }).gc;
            if (typeof g === 'function') {
                g();
            }
        }
    }

    if (options?.skipTests) {
        graph.tests = [];
    }

    return { ...graph, parseErrors, extractErrors };
}
