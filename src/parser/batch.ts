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

        // Dynamic batch sizing: reduce if memory pressure detected
        const rss = process.memoryUsage().rss;
        if (rss > maxMemBytes * MEMORY_THRESHOLD_RATIO) {
            const oldBatch = batchSize;
            batchSize = Math.max(5, Math.floor(batchSize / 2));
            log.warn('Memory pressure detected, reducing batch size', {
                rssMB: Math.round(rss / 1024 / 1024),
                maxMB: Math.round(maxMemBytes / 1024 / 1024),
                oldBatchSize: oldBatch,
                newBatchSize: batchSize,
            });
        }
    }

    if (options?.skipTests) {
        graph.tests = [];
    }

    return { ...graph, parseErrors, extractErrors };
}
