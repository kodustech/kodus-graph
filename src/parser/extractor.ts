import type { SgRoot } from '@ast-grep/napi';
import { Lang } from '@ast-grep/napi';
import type { RawGraph } from '../graph/types';
import type { RawCallSite } from '../graph/types';
import { extractTypeScript } from './extractors/typescript';
import { extractPython } from './extractors/python';
import { extractRuby } from './extractors/ruby';
import { extractGeneric } from './extractors/generic';
import { extractCallsFromTypeScript } from './extractors/typescript';
import { extractCallsFromPython } from './extractors/python';
import { extractCallsFromRuby } from './extractors/ruby';
import { extractCallsFromGeneric } from './extractors/generic';
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

export function extractCallsFromFile(
  root: SgRoot,
  filePath: string,
  lang: Lang | string,
  calls: RawCallSite[],
): void {
  if (isTypeScriptLike(lang)) {
    extractCallsFromTypeScript(root, filePath, calls);
  } else if (lang === 'python') {
    extractCallsFromPython(root, filePath, calls);
  } else if (lang === 'ruby') {
    extractCallsFromRuby(root, filePath, calls);
  } else {
    extractCallsFromGeneric(root, filePath, calls);
  }
}
