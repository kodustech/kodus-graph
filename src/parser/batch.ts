import type { SgRoot } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { extname, relative } from 'path';
import type { ParseBatchResult, RawCallSite, RawGraph } from '../graph/types';
import { NOISE } from '../shared/filters';
import { log } from '../shared/logger';
import { extractCallsFromFile, extractFromFile } from './extractor';
import { getLanguage } from './languages';

const BATCH_SIZE = 50;

export async function parseBatch(files: string[], repoRoot: string): Promise<ParseBatchResult> {
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

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);

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
                // Extract calls into a temporary buffer, then filter noise before pushing
                const rawCalls: RawCallSite[] = [];
                extractCallsFromFile(root, fp, lang, rawCalls);
                for (const call of rawCalls) {
                    if (!NOISE.has(call.callName)) {
                        graph.rawCalls.push(call);
                    }
                }
            } catch (err) {
                log.error('Call extraction crashed', { file: fp, error: String(err) });
                extractErrors++;
            }
        });

        await Promise.all(promises);
    }

    return { ...graph, parseErrors, extractErrors };
}
