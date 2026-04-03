import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { extname, relative } from 'path';
import { getLanguage } from './languages';
import { extractFromFile } from './extractor';
import type { RawGraph } from '../graph/types';

const BATCH_SIZE = 50;

export async function parseBatch(
  files: string[],
  repoRoot: string,
): Promise<RawGraph> {
  const graph: RawGraph = {
    functions: [], classes: [], interfaces: [], enums: [],
    tests: [], imports: [], reExports: [],
    diMaps: new Map(),
  };
  const seen = new Set<string>();

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (filePath) => {
      const lang = getLanguage(extname(filePath));
      if (!lang) return;

      let source: string;
      try { source = readFileSync(filePath, 'utf-8'); } catch { return; }

      let root;
      try { root = await parseAsync(lang, source); } catch { return; }

      const fp = relative(repoRoot, filePath);
      try { extractFromFile(root, fp, lang, seen, graph); } catch { /* skip */ }
    });

    await Promise.all(promises);
  }

  return graph;
}
