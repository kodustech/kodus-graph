import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../graph/types';

/**
 * Language-specific configuration for call extraction.
 * Each language provides its self/super patterns and how to find class context in the AST.
 *
 * Note: noise filtering is intentionally NOT performed at extraction time.
 * The resolver applies the per-language noise filter AFTER the receiver-type
 * tier (`src/resolver/call-resolver.ts`) so user-domain calls like
 * `user.update()` — where `update` is in a language noise list but
 * `UserService.update` exists in the symbol table — aren't dropped before
 * they can be resolved. Dropping noise at extraction would kill that tier.
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
    /**
     * Optional: derive a diField from the callee text. When set, every call
     * with a single-segment receiver (e.g., `repo.find` or `this.repo.find`)
     * threads that segment as `diField`. The resolver only routes through DI
     * if the field is in the file's diMap, so non-DI identifiers fall through
     * harmlessly to receiver/import/unique tiers.
     */
    extractDiField?: (callee: string) => string | undefined;
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
        const calleeNode = m.getMatch('CALLEE');
        const callee = calleeNode?.text();
        if (!callee) {
            continue;
        }
        if (config.skipCallee?.(callee)) {
            continue;
        }

        const callName = callee.includes('.') ? callee.split('.').pop()! : callee;

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

        const diField = resolveInClass ? undefined : config.extractDiField?.(callee);

        // Column convention: end-of-callee text (≈ position of `(` in args).
        // For `repo.find(1)` it's the col after `find`. For `repo.find(1).greet()`
        // (the OUTER chained call) it's the col after `greet` — distinct from
        // the inner `find` call. Without this, both calls share the receiver-
        // start column and chained calls collide on receiver-type lookup.
        const calleeEnd = calleeNode?.range().end;
        const line = calleeEnd?.line ?? m.range().start.line;
        const column = calleeEnd?.column ?? m.range().start.column;

        calls.push({
            source: fp,
            callName,
            line,
            column,
            ...(resolveInClass ? { resolveInClass } : {}),
            ...(diField ? { diField } : {}),
        });
    }
}
