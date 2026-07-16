import type { Lang, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../graph/types';
import { extractAll as engineExtractAll, extractCallsFromEngine } from '../languages/engine';

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
import '../languages/bash';

// `Lang` from ast-grep is a string enum (`Lang.TypeScript === 'TypeScript'`),
// so any `Lang | string` value is already a string at runtime — registry keys
// match the Lang literals for built-ins, no name remap needed.

export function extractFromFile(
    root: SgRoot,
    filePath: string,
    lang: Lang | string,
    seen: Set<string>,
    graph: RawGraph,
): void {
    engineExtractAll(root, filePath, lang as string, seen, graph);
}

export function extractCallsFromFile(root: SgRoot, filePath: string, lang: Lang | string, calls: RawCallSite[]): void {
    extractCallsFromEngine(root, filePath, lang as string, calls);
}
