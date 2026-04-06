import type { ContextOutput, GraphData } from '../graph/types';
import { computeBlastRadius } from './blast-radius';
import { computeRiskScore } from './risk-score';
import { findTestGaps } from './test-gaps';

export function buildReviewContext(graph: GraphData, changedFiles: string[]): ContextOutput {
  const changedSet = new Set(changedFiles);
  const lines: string[] = [];

  // Build caller/callee index from CALLS edges
  const callersOf = new Map<string, Array<{ name: string; file: string; line: number; confidence: number }>>();
  const calleesOf = new Map<
    string,
    Array<{ name: string; target: string; file: string; line: number; confidence: number }>
  >();

  // Index nodes by qualified name
  const nodeIndex = new Map(graph.nodes.map((n) => [n.qualified_name, n]));

  for (const edge of graph.edges) {
    if (edge.kind !== 'CALLS' || (edge.confidence ?? 0) < 0.5) continue;

    // callers: who calls edge.target
    if (!callersOf.has(edge.target_qualified)) callersOf.set(edge.target_qualified, []);
    const sourceNode = nodeIndex.get(edge.source_qualified);
    callersOf.get(edge.target_qualified)!.push({
      name: sourceNode?.name || edge.source_qualified.split('::').pop() || 'unknown',
      file: sourceNode?.file_path || edge.file_path,
      line: edge.line,
      confidence: edge.confidence || 0,
    });

    // callees: what does source call
    if (!calleesOf.has(edge.source_qualified)) calleesOf.set(edge.source_qualified, []);
    const targetNode = nodeIndex.get(edge.target_qualified);
    calleesOf.get(edge.source_qualified)!.push({
      name: targetNode?.name || edge.target_qualified.split('::').pop() || 'unknown',
      target: edge.target_qualified,
      file: targetNode?.file_path || '',
      line: edge.line,
      confidence: edge.confidence || 0,
    });
  }

  // TESTED_BY index
  const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.source_qualified));

  lines.push('Changed functions (AST analysis):\n');

  // Functions in changed files
  const changedFunctions = graph.nodes
    .filter(
      (n) =>
        changedSet.has(n.file_path) && !n.is_test && n.kind !== 'Class' && n.kind !== 'Interface' && n.kind !== 'Enum',
    )
    .sort((a, b) => a.file_path.localeCompare(b.file_path) || a.line_start - b.line_start);

  let callerCount = 0;
  let calleeCount = 0;

  for (const func of changedFunctions) {
    if (func.kind === 'Constructor') continue;

    const shortName = func.name.includes('.') ? func.name.split('.').pop()! : func.name;
    const sig = func.params && func.params !== '()' ? `${shortName}${func.params}` : shortName;
    const ret = func.return_type ? ` -> ${func.return_type}` : '';
    lines.push(`${sig}${ret}  (${func.file_path}:${func.line_start})`);

    // Callers
    const callers = callersOf.get(func.qualified_name) || [];
    callerCount += callers.length;
    for (const caller of callers.slice(0, 5)) {
      const conf = caller.confidence >= 0.85 ? '' : ` [${Math.round(caller.confidence * 100)}%]`;
      lines.push(`  ← called by ${caller.name} (${caller.file}:${caller.line})${conf}`);
    }
    if (callers.length > 5) lines.push(`  ← ... and ${callers.length - 5} more callers`);

    // Callees
    const callees = calleesOf.get(func.qualified_name) || [];
    calleeCount += callees.length;
    const seenCallees = new Set<string>();
    for (const callee of callees.slice(0, 5)) {
      if (seenCallees.has(callee.target)) continue;
      seenCallees.add(callee.target);
      const calleeNode = nodeIndex.get(callee.target);
      if (calleeNode) {
        const calleeSig =
          calleeNode.params && calleeNode.params !== '()' ? `${callee.name}${calleeNode.params}` : callee.name;
        const calleeRet = calleeNode.return_type ? ` -> ${calleeNode.return_type}` : '';
        lines.push(`  → calls ${calleeSig}${calleeRet}  (${calleeNode.file_path}:${calleeNode.line_start})`);
      } else {
        lines.push(`  → calls ${callee.name}  (${callee.file || 'external'})`);
      }
    }

    // Test coverage
    if (testedFiles.has(func.file_path)) {
      lines.push(`  ✅ has test coverage`);
    } else {
      lines.push(`  ⚠ NO TEST COVERAGE`);
    }

    lines.push('');
  }

  // Blast radius
  const blastRadius = computeBlastRadius(graph, changedFiles);
  if (blastRadius.total_files > changedFiles.length) {
    lines.push(
      `Blast radius: ${changedFunctions.filter((f) => f.kind !== 'Constructor').length} changed functions impact ${blastRadius.total_files - changedFiles.length} other files`,
    );
  }

  // Risk score
  const riskScore = computeRiskScore(graph, changedFiles, blastRadius);
  lines.push(`\nRisk: ${riskScore.level} (${riskScore.score})`);

  // Test gaps
  const testGaps = findTestGaps(graph, changedFiles);
  const untestedCount = testGaps.length;
  if (untestedCount > 0) {
    lines.push(`\n⚠ ${untestedCount} changed function(s) without test coverage:`);
    for (const gap of testGaps.slice(0, 10)) {
      const shortName = gap.function.split('::').pop() || gap.function;
      lines.push(`  ${shortName} (${gap.file_path}:${gap.line_start})`);
    }
  }

  return {
    text: lines.join('\n'),
    metadata: {
      changed_functions: changedFunctions.filter((f) => f.kind !== 'Constructor').length,
      caller_count: callerCount,
      callee_count: calleeCount,
      untested_count: untestedCount,
      blast_radius: { functions: blastRadius.total_functions, files: blastRadius.total_files },
      risk_level: riskScore.level,
      risk_score: riskScore.score,
    },
  };
}
