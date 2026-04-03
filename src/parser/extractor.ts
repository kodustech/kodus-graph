import type { SgRoot } from '@ast-grep/napi';
import { Lang } from '@ast-grep/napi';
import type { RawGraph } from '../graph/types';
import { extractTypeScript } from './extractors/typescript';
import { extractPython } from './extractors/python';
import { extractRuby } from './extractors/ruby';
import { extractGeneric } from './extractors/generic';
import { isTypeScriptLike } from './languages';

export function extractFromFile(
  root: SgRoot,
  filePath: string,
  lang: Lang | string,
  seen: Set<string>,
  graph: RawGraph,
): void {
  if (isTypeScriptLike(lang)) {
    extractTypeScript(root, filePath, seen, graph);
  } else if (lang === 'python') {
    extractPython(root, filePath, seen, graph);
  } else if (lang === 'ruby') {
    extractRuby(root, filePath, seen, graph);
  } else {
    extractGeneric(root, filePath, lang as string, seen, graph);
  }
}
