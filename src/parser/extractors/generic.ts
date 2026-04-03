import type { SgNode, SgRoot } from '@ast-grep/napi';
import { LANG_KINDS } from '../languages';
import type { RawGraph } from '../../graph/types';
import { log } from '../../shared/logger';

export function extractGeneric(
  root: SgRoot,
  fp: string,
  lang: string,
  seen: Set<string>,
  graph: RawGraph,
): void {
  const kinds = LANG_KINDS[lang];
  if (!kinds) return;
  const rootNode = root.root();

  // Try to extract classes
  for (const classKind of [kinds.class, kinds.struct, kinds.interface].filter(Boolean)) {
    try {
      for (const node of rootNode.findAll({ rule: { kind: classKind } })) {
        const name = node.field('name')?.text();
        if (!name || seen.has(`c:${fp}:${name}`)) continue;
        seen.add(`c:${fp}:${name}`);
        graph.classes.push({
          name,
          file: fp,
          line_start: node.range().start.line,
          line_end: node.range().end.line,
          extends: '',
          implements: '',
          qualified: `${fp}::${name}`,
        });
      }
    } catch (err) {
      log.debug('Generic extraction failed', { file: fp, error: String(err) });
    }
  }

  // Try to extract functions/methods
  for (const funcKind of [kinds.function, kinds.method, kinds.constructor].filter(Boolean)) {
    try {
      for (const node of rootNode.findAll({ rule: { kind: funcKind } })) {
        const name = node.field('name')?.text();
        if (!name) continue;
        const line = node.range().start.line;
        if (seen.has(`f:${fp}:${name}:${line}`)) continue;
        seen.add(`f:${fp}:${name}:${line}`);

        const classAncestor = node.ancestors().find((a: SgNode) => {
          const k = a.kind();
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
          qualified: className
            ? `${fp}::${className}.${name}`
            : `${fp}::${name}`,
        });
      }
    } catch (err) {
      log.debug('Generic extraction failed', { file: fp, error: String(err) });
    }
  }
}
