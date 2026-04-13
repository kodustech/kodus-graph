import type { Lang, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../graph/types';
import { extractAll as engineExtractAll, extractCallsFromEngine, hasExtractor } from './extractors/engine';
import { extractCallsFromGeneric, extractGeneric } from './extractors/generic';
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

export function extractFromFile(
    root: SgRoot,
    filePath: string,
    lang: Lang | string,
    seen: Set<string>,
    graph: RawGraph,
): void {
    const langStr = typeof lang === 'string' ? lang : getLanguageName(lang);
    if (hasExtractor(langStr)) {
        engineExtractAll(root, filePath, langStr, seen, graph);
        return;
    }
    // Fallback for any language without a dedicated extractor
    extractGeneric(root, filePath, lang as string, seen, graph);
}

export function extractCallsFromFile(root: SgRoot, filePath: string, lang: Lang | string, calls: RawCallSite[]): void {
    const langStr = typeof lang === 'string' ? lang : getLanguageName(lang);
    if (hasExtractor(langStr)) {
        extractCallsFromEngine(root, filePath, langStr, calls);
        return;
    }
    extractCallsFromGeneric(root, filePath, lang as string, calls);
}
