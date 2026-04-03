import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { extname, relative } from 'path';
import { getLanguage } from './languages';
import { extractFromFile } from './extractor';
import { extractCallsFromFile } from './extractor';
import type { RawGraph } from '../graph/types';
import { log } from '../shared/logger';

const BATCH_SIZE = 50;

export async function parseBatch(
  files: string[],
  repoRoot: string,
): Promise<RawGraph & { parseErrors: number; extractErrors: number }> {
  const graph: RawGraph = {
    functions: [], classes: [], interfaces: [], enums: [],
    tests: [], imports: [], reExports: [], rawCalls: [],
    diMaps: new Map(),
  };
  const seen = new Set<string>();
  let parseErrors = 0;
  let extractErrors = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (filePath) => {
      const lang = getLanguage(extname(filePath));
      if (!lang) return;

      let source: string;
      try { source = readFileSync(filePath, 'utf-8'); } catch (err) {
        log.warn('Failed to read file', { file: filePath, error: String(err) });
        parseErrors++;
        return;
      }

      let root;
      try { root = await parseAsync(lang, source); } catch (err) {
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
        extractCallsFromFile(root, fp, lang, graph.rawCalls);
      } catch (err) {
        log.error('Call extraction crashed', { file: fp, error: String(err) });
        extractErrors++;
      }
    });

    await Promise.all(promises);
  }

  return Object.assign(graph, { parseErrors, extractErrors });
}
