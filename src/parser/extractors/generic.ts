import type { SgNode, SgRoot } from '@ast-grep/napi';
import type { RawCallSite, RawGraph } from '../../graph/types';
import { type CallExtractionConfig, extractCalls } from '../../shared/extract-calls';
import { computeContentHash } from '../../shared/file-hash';
import { log } from '../../shared/logger';
import { LANG_KINDS } from '../languages';

export function extractGeneric(root: SgRoot, fp: string, lang: string, seen: Set<string>, graph: RawGraph): void {
    const kinds = LANG_KINDS[lang];
    if (!kinds) {
        return;
    }
    const rootNode = root.root();

    // Try to extract classes
    for (const classKind of [kinds.class, kinds.struct, kinds.interface].filter(Boolean)) {
        try {
            for (const node of rootNode.findAll({ rule: { kind: classKind } })) {
                const name = node.field('name')?.text();
                if (!name || seen.has(`c:${fp}:${name}`)) {
                    continue;
                }
                seen.add(`c:${fp}:${name}`);
                graph.classes.push({
                    name,
                    file: fp,
                    line_start: node.range().start.line,
                    line_end: node.range().end.line,
                    extends: '',
                    implements: '',
                    qualified: `${fp}::${name}`,
                    content_hash: computeContentHash(node.text()),
                });
            }
        } catch (err) {
            log.debug('Generic extraction failed', { file: fp, error: String(err) });
        }
    }

    // Try to extract functions/methods
    // biome-ignore lint/complexity/useLiteralKeys: 'constructor' must use bracket notation to avoid Object.prototype.constructor
    for (const funcKind of [kinds.function, kinds.method, kinds['constructor'] as string | undefined].filter(Boolean)) {
        try {
            for (const node of rootNode.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) {
                    continue;
                }
                const line = node.range().start.line;
                if (seen.has(`f:${fp}:${name}:${line}`)) {
                    continue;
                }
                seen.add(`f:${fp}:${name}:${line}`);

                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                const className = classAncestor?.field('name')?.text() || '';

                graph.functions.push({
                    name,
                    file: fp,
                    line_start: line,
                    line_end: node.range().end.line,
                    params: node.field('parameters')?.text() || '()',
                    returnType: node.field('return_type')?.text() || '',
                    kind: className ? 'Method' : 'Function',
                    className,
                    qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
                    content_hash: computeContentHash(node.text()),
                });
            }
        } catch (err) {
            log.debug('Generic extraction failed', { file: fp, error: String(err) });
        }
    }
}

/** Shared class-finder for languages using class/struct/impl AST kinds. */
function findEnclosingClassGeneric(node: import('@ast-grep/napi').SgNode): import('@ast-grep/napi').SgNode | null {
    return (
        node.ancestors().find((a) => {
            const k = String(a.kind());
            return k.includes('class') || k.includes('struct') || k.includes('impl');
        }) ?? null
    );
}

/** Per-language call extraction configs for self/super detection. */
const GENERIC_CONFIGS: Record<string, CallExtractionConfig> = {
    java: {
        selfPrefixes: ['this.'],
        superPrefixes: ['super.'],
        findEnclosingClass: findEnclosingClassGeneric,
        getParentClass: (classNode) => {
            const sc = classNode.children().find((c) => c.kind() === 'superclass');
            return sc
                ?.children()
                .find((c) => c.kind() === 'type_identifier')
                ?.text();
        },
    },
    csharp: {
        selfPrefixes: ['this.'],
        superPrefixes: ['base.'],
        findEnclosingClass: findEnclosingClassGeneric,
        getParentClass: (classNode) => {
            const bl = classNode.children().find((c) => c.kind() === 'base_list');
            return bl
                ?.children()
                .find((c) => c.kind() === 'identifier' || c.kind() === 'type_identifier')
                ?.text();
        },
    },
    rust: {
        selfPrefixes: ['self.'],
        superPrefixes: [],
        findEnclosingClass: (node) => node.ancestors().find((a) => a.kind() === 'impl_item') ?? null,
    },
    go: {
        selfPrefixes: [],
        superPrefixes: [],
        findEnclosingClass: findEnclosingClassGeneric,
    },
    php: {
        selfPrefixes: [],
        superPrefixes: [],
        findEnclosingClass: findEnclosingClassGeneric,
    },
};

/** Fallback config for unknown languages — no self/super detection. */
const FALLBACK_CONFIG: CallExtractionConfig = {
    selfPrefixes: [],
    superPrefixes: [],
    findEnclosingClass: findEnclosingClassGeneric,
};

/**
 * Extract raw call sites from a generic language AST.
 * Uses per-language config for self/super detection.
 */
export function extractCallsFromGeneric(root: SgRoot, fp: string, lang: string, calls: RawCallSite[]): void {
    const config = GENERIC_CONFIGS[lang] ?? FALLBACK_CONFIG;
    extractCalls(root.root(), fp, config, calls);
}
