import type { Lang, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../graph/types';
import { log } from '../shared/logger';
import { extractAll as engineExtractAll, extractCallsFromEngine } from './extractors/engine';
import { getLanguageName } from './languages';

// Import language files to trigger registration
import './extractors/go';
import './extractors/java';
import './extractors/kotlin';
import './extractors/rust';
import './extractors/csharp';
import './extractors/php';
import './extractors/typescript';
import './extractors/python';
import './extractors/ruby';
import './extractors/swift';
import './extractors/dart';
import './extractors/scala';
import './extractors/elixir';
import './extractors/c';

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
