import type { Lang, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../graph/types';
import { extractCallsFromGeneric, extractGeneric } from './extractors/generic';
import { extractCallsFromPython, extractPython } from './extractors/python';
import { extractCallsFromRuby, extractRuby } from './extractors/ruby';
import { extractCallsFromTypeScript, extractTypeScript } from './extractors/typescript';
import { isTypeScriptLike } from './languages';

export function extractFromFile(
    root: SgRoot,
    filePath: string,
    lang: Lang | string,
    seen: Set<string>,
    graph: RawGraph,
): void {
    if (isTypeScriptLike(lang)) {
        extractTypeScript(root, filePath, seen, graph, lang);
    } else if (lang === 'python') {
        extractPython(root, filePath, seen, graph);
    } else if (lang === 'ruby') {
        extractRuby(root, filePath, seen, graph);
    } else {
        extractGeneric(root, filePath, lang as string, seen, graph);
    }
}

export function extractCallsFromFile(root: SgRoot, filePath: string, lang: Lang | string, calls: RawCallSite[]): void {
    if (isTypeScriptLike(lang)) {
        extractCallsFromTypeScript(root, filePath, calls);
    } else if (lang === 'python') {
        extractCallsFromPython(root, filePath, calls);
    } else if (lang === 'ruby') {
        extractCallsFromRuby(root, filePath, calls);
    } else {
        extractCallsFromGeneric(root, filePath, lang as string, calls);
    }
}
