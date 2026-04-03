import type { SgNode, SgRoot } from '@ast-grep/napi';
import { LANG_KINDS } from '../languages';
import type { RawGraph } from '../../graph/types';
import { log } from '../../shared/logger';

export function extractRuby(
  root: SgRoot,
  fp: string,
  seen: Set<string>,
  graph: RawGraph,
): void {
  const kinds = LANG_KINDS['ruby'];
  const rootNode = root.root();

  // ── Classes ──
  for (const node of rootNode.findAll({ rule: { kind: kinds.class } })) {
    const name = node.field('name')?.text();
    if (!name || seen.has(`c:${fp}:${name}`)) continue;
    seen.add(`c:${fp}:${name}`);

    const superclass = node.field('superclass')?.text() || '';
    graph.classes.push({
      name,
      file: fp,
      line_start: node.range().start.line,
      line_end: node.range().end.line,
      extends: superclass,
      implements: '',
      qualified: `${fp}::${name}`,
    });
  }

  // ── Modules ──
  for (const node of rootNode.findAll({ rule: { kind: kinds.module } })) {
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

  // ── Methods ──
  for (const node of rootNode.findAll({ rule: { kind: kinds.method } })) {
    const name = node.field('name')?.text();
    if (!name) continue;
    const line = node.range().start.line;
    if (seen.has(`m:${fp}:${name}:${line}`)) continue;
    seen.add(`m:${fp}:${name}:${line}`);

    const classAncestor = node
      .ancestors()
      .find((a: SgNode) => a.kind() === kinds.class || a.kind() === kinds.module);
    const className = classAncestor?.field('name')?.text() || '';

    graph.functions.push({
      name,
      file: fp,
      line_start: line,
      line_end: node.range().end.line,
      params: node.field('parameters')?.text() || '()',
      returnType: '',
      kind: className ? 'Method' : 'Function',
      className,
      qualified: className ? `${fp}::${className}.${name}` : `${fp}::${name}`,
    });
  }

  // ── Tests (RSpec: describe/it/context) ──
  for (const p of [
    "describe '$NAME' do $$$BODY end",
    'describe "$NAME" do $$$BODY end',
    "it '$NAME' do $$$BODY end",
    'it "$NAME" do $$$BODY end',
    "context '$NAME' do $$$BODY end",
    'context "$NAME" do $$$BODY end',
  ]) {
    try {
      for (const m of rootNode.findAll(p)) {
        const name = m.getMatch('NAME')?.text();
        if (!name) continue;
        const key = `t:${fp}:${name}:${m.range().start.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        graph.tests.push({
          name,
          file: fp,
          line_start: m.range().start.line,
          line_end: m.range().end.line,
          qualified: `${fp}::test:${name}`,
        });
      }
    } catch (err) {
      log.debug('Ruby pattern mismatch', { file: fp, pattern: p, error: String(err) });
    }
  }

  // ── Imports (require/require_relative) ──
  for (const p of [
    "require '$MODULE'",
    'require "$MODULE"',
    "require_relative '$MODULE'",
    'require_relative "$MODULE"',
  ]) {
    try {
      for (const m of rootNode.findAll(p)) {
        const mod = m.getMatch('MODULE')?.text();
        if (mod) {
          graph.imports.push({
            module: mod,
            file: fp,
            line: m.range().start.line,
            names: [],
            lang: 'ruby',
          });
        }
      }
    } catch (err) {
      log.debug('Ruby pattern mismatch', { file: fp, pattern: p, error: String(err) });
    }
  }
}
