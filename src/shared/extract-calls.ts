import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../graph/types';
import { NOISE } from './filters';

/**
 * Language-specific configuration for call extraction.
 * Each language provides its self/super patterns and how to find class context in the AST.
 */
export interface CallExtractionConfig {
    /** Prefixes indicating a self-reference (e.g., 'self.', 'this.') */
    selfPrefixes: string[];
    /** Prefixes indicating a super-reference (e.g., 'super().', 'super.', 'base.') */
    superPrefixes: string[];
    /** Find the enclosing class/module/impl node from a call site */
    findEnclosingClass: (node: SgNode) => SgNode | null;
    /** Extract the parent class name from a class node (for super resolution) */
    getParentClass?: (classNode: SgNode) => string | undefined;
    /** Skip this callee entirely (e.g., TS skips this.field.method — handled by DI) */
    skipCallee?: (callee: string) => boolean;
}

/**
 * Shared call extraction for all languages.
 *
 * Parses `$CALLEE($$$ARGS)` pattern, detects self/super references
 * based on language config, and populates resolveInClass for
 * class-aware resolution downstream.
 */
export function extractCalls(rootNode: SgNode, fp: string, config: CallExtractionConfig, calls: RawCallSite[]): void {
    for (const m of rootNode.findAll('$CALLEE($$$ARGS)')) {
        const callee = m.getMatch('CALLEE')?.text();
        if (!callee) {
            continue;
        }
        if (config.skipCallee?.(callee)) {
            continue;
        }

        const callName = callee.includes('.') ? callee.split('.').pop()! : callee;
        if (NOISE.has(callName)) {
            continue;
        }

        let resolveInClass: string | undefined;

        // Check self-reference: callee must be exactly `prefix + methodName` (no further chaining)
        for (const prefix of config.selfPrefixes) {
            if (!callee.startsWith(prefix)) {
                continue;
            }
            const rest = callee.substring(prefix.length);
            if (rest.includes('.')) {
                break; // chained access (e.g., this.field.method) — not a self call
            }
            const classNode = config.findEnclosingClass(m);
            resolveInClass = classNode?.field('name')?.text();
            break;
        }

        // Check super-reference if no self match
        if (!resolveInClass) {
            for (const prefix of config.superPrefixes) {
                const matches =
                    callee === prefix || (callee.startsWith(prefix) && !callee.substring(prefix.length).includes('.'));
                if (!matches) {
                    continue;
                }
                const classNode = config.findEnclosingClass(m);
                if (classNode && config.getParentClass) {
                    resolveInClass = config.getParentClass(classNode);
                }
                break;
            }
        }

        calls.push({
            source: fp,
            callName,
            line: m.range().start.line,
            ...(resolveInClass ? { resolveInClass } : {}),
        });
    }
}
