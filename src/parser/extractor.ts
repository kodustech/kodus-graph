import type { Lang, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../graph/types';
import { extractAll as engineExtractAll, extractCallsFromEngine } from '../languages/engine';
import { getLanguageName } from './languages';

// Import language barrel files to trigger extractor registration.
import '../languages/go';
import '../languages/java';
import '../languages/kotlin';
import '../languages/rust';
import '../languages/csharp';
import '../languages/php';
import '../languages/typescript';
import '../languages/python';
import '../languages/ruby';
import '../languages/swift';
import '../languages/dart';
import '../languages/scala';
import '../languages/elixir';
import '../languages/c';

export function extractFromFile(
    root: SgRoot,
    filePath: string,
    lang: Lang | string,
    seen: Set<string>,
    graph: RawGraph,
): void {
    const langStr = typeof lang === 'string' ? lang : getLanguageName(lang);
    engineExtractAll(root, filePath, langStr, seen, graph);
}

export function extractCallsFromFile(root: SgRoot, filePath: string, lang: Lang | string, calls: RawCallSite[]): void {
    const langStr = typeof lang === 'string' ? lang : getLanguageName(lang);
    extractCallsFromEngine(root, filePath, langStr, calls);
}
