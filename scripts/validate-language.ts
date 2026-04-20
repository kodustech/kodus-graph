#!/usr/bin/env bun
/**
 * Smoke-validation harness for Fase D.
 *
 * Usage:
 *   bun run scripts/validate-language.ts --repo <clone-path> --lang <key> --out <report-path>
 *
 * Runs kodus-graph `parse --all` on the repo, extracts tier_distribution,
 * language breakdown, alternatives coverage, complexity coverage, high-conf
 * edge count. Writes a markdown report. Deletes the intermediate graph JSON.
 *
 * Always uses `--max-memory 1024` so large repos don't thrash.
 * Excludes node_modules / vendor / target / .git / build / dist / __pycache__ / venv.
 */
import { existsSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';

interface Args {
    repo: string;
    lang: string;
    out: string;
}

function parseArgs(): Args {
    const args: Partial<Args> = {};
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i];
        const value = process.argv[i + 1];
        if (key === '--repo') args.repo = value;
        if (key === '--lang') args.lang = value;
        if (key === '--out') args.out = value;
    }
    if (!args.repo || !args.lang || !args.out) {
        throw new Error('Usage: validate-language --repo <path> --lang <key> --out <report-path>');
    }
    return args as Args;
}

async function main(): Promise<void> {
    const { repo, lang, out } = parseArgs();
    if (!existsSync(repo)) {
        throw new Error(`repo not found: ${repo}`);
    }

    const tmpGraph = `/tmp/fase-d-${lang}-graph.json`;
    const started = Date.now();

    const parseResult = spawnSync(
        'bun',
        [
            'run',
            'src/cli.ts',
            'parse',
            '--all',
            '--repo-dir',
            repo,
            '--out',
            tmpGraph,
            '--max-memory',
            '1024',
            '--exclude',
            '**/node_modules/**',
            '**/vendor/**',
            '**/.git/**',
            '**/target/**',
            '**/build/**',
            '**/dist/**',
            '**/__pycache__/**',
            '**/venv/**',
            '**/.venv/**',
        ],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const parseStderr = parseResult.stderr || '';
    const parseExit = parseResult.status;

    if (parseExit !== 0 || !existsSync(tmpGraph)) {
        const report = buildFailureReport({ lang, repo, elapsed, parseExit, parseStderr });
        await Bun.write(out, report);
        console.log(`FAIL: parse exited ${parseExit}. Report at ${out}`);
        if (existsSync(tmpGraph)) {
            rmSync(tmpGraph);
        }
        process.exit(1);
    }

    const graph = await Bun.file(tmpGraph).json();
    const metrics = computeMetrics(graph);

    const report = buildSuccessReport({ lang, repo, elapsed, metrics, parseStderr });
    await Bun.write(out, report);

    rmSync(tmpGraph);
    console.log(`OK: ${lang} — report at ${out}`);
}

interface Metrics {
    files_parsed: number;
    total_nodes: number;
    total_edges: number;
    parse_errors: number;
    extract_errors: number;
    tier_distribution: Record<string, number>;
    languages: Record<string, number>;
    fn_count: number;
    complexity_coverage_ratio: number;
    ambiguous_count: number;
    alternatives_ratio: number;
    high_conf_count: number;
    high_conf_ratio: number;
    resolved_ratio: number;
    passes_full_tier_bar: boolean;
    bar_failures: string[];
}

function computeMetrics(graph: { metadata: Record<string, unknown>; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }): Metrics {
    const metadata = graph.metadata;
    const td = (metadata.tier_distribution as Record<string, number>) ?? {};

    const langs: Record<string, number> = {};
    for (const n of graph.nodes) {
        const k = String(n.language ?? 'unknown');
        langs[k] = (langs[k] ?? 0) + 1;
    }

    const fns = graph.nodes.filter((n) => n.kind === 'Function' || n.kind === 'Method');
    const withCpx = fns.filter((n) => typeof n.complexity === 'number');

    const ambig = graph.edges.filter((e) => e.confidence === 0.3);
    const withAlt = ambig.filter((e) => Array.isArray(e.alternatives) && (e.alternatives as unknown[]).length > 0);

    const highConf = graph.edges.filter(
        (e) => e.kind === 'CALLS' && (e.confidence === 0.95 || e.confidence === 0.9),
    );

    const totalResolved =
        (td.receiver ?? 0) + (td.di ?? 0) + (td.same ?? 0) + (td.import ?? 0) + (td.unique ?? 0) + (td.ambiguous ?? 0);
    const totalCallSites = totalResolved + (td.noise ?? 0) + (td.ambiguousNoise ?? 0);
    const resolvedRatio = totalCallSites === 0 ? 0 : totalResolved / totalCallSites;
    const ambigRatio = totalResolved === 0 ? 0 : (td.ambiguous ?? 0) / totalResolved;
    const highConfRatio = totalResolved === 0 ? 0 : ((td.receiver ?? 0) + (td.di ?? 0) + (td.same ?? 0)) / totalResolved;
    const nodes = Number(metadata.total_nodes ?? 0);
    const receiverPer1k = nodes === 0 ? 0 : ((td.receiver ?? 0) * 1000) / nodes;
    const diPer1k = nodes === 0 ? 0 : ((td.di ?? 0) * 1000) / nodes;

    // Apply the same full-tier bar CI enforces (loose floor of the two real
    // full languages: python + go).
    const bar_failures: string[] = [];
    if (resolvedRatio < 0.4) bar_failures.push(`resolvedRatio ${resolvedRatio.toFixed(3)} < 0.4`);
    if (ambigRatio > 0.6) bar_failures.push(`ambigRatio ${ambigRatio.toFixed(3)} > 0.6`);
    if (receiverPer1k < 1 && diPer1k < 1) bar_failures.push(`receiver+di per-1k both < 1`);
    if (highConfRatio < 0.1) bar_failures.push(`highConfRatio ${highConfRatio.toFixed(3)} < 0.1`);
    if ((metadata.parse_errors as number) > 0) bar_failures.push(`parse_errors > 0`);
    if ((metadata.extract_errors as number) > 0) bar_failures.push(`extract_errors > 0`);

    return {
        files_parsed: Number(metadata.files_parsed ?? 0),
        total_nodes: Number(metadata.total_nodes ?? 0),
        total_edges: Number(metadata.total_edges ?? 0),
        parse_errors: Number(metadata.parse_errors ?? 0),
        extract_errors: Number(metadata.extract_errors ?? 0),
        tier_distribution: td,
        languages: langs,
        fn_count: fns.length,
        complexity_coverage_ratio: fns.length === 0 ? 0 : withCpx.length / fns.length,
        ambiguous_count: ambig.length,
        alternatives_ratio: ambig.length === 0 ? 0 : withAlt.length / ambig.length,
        high_conf_count: highConf.length,
        high_conf_ratio: highConfRatio,
        resolved_ratio: resolvedRatio,
        passes_full_tier_bar: bar_failures.length === 0,
        bar_failures,
    };
}

function buildFailureReport(args: { lang: string; repo: string; elapsed: string; parseExit: number | null; parseStderr: string }): string {
    return [
        `# ${args.lang} validation — PARSE FAILED`,
        '',
        `- repo: \`${args.repo}\``,
        `- parse duration: ${args.elapsed}s`,
        `- exit code: ${args.parseExit}`,
        '',
        '## Last lines of stderr',
        '',
        '```',
        args.parseStderr.split('\n').slice(-30).join('\n'),
        '```',
        '',
        '## Verdict',
        '',
        '**Parse failed. Language needs investigation before it can be promoted beyond basic tier.**',
        '',
    ].join('\n');
}

function buildSuccessReport(args: { lang: string; repo: string; elapsed: string; metrics: Metrics; parseStderr: string }): string {
    const m = args.metrics;
    const tierIcon = m.passes_full_tier_bar ? '🟢' : '🟡';
    const verdict = m.passes_full_tier_bar
        ? `Clears the full-tier bar. Candidate for promotion.`
        : `Does NOT clear the full-tier bar. See failures below.`;

    const langBreakdown = Object.entries(m.languages)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

    const tierLines = Object.entries(m.tier_distribution)
        .map(([k, v]) => `| ${k} | ${v} |`)
        .join('\n');

    return [
        `# ${args.lang} validation — ${tierIcon} ${m.passes_full_tier_bar ? 'PASS' : 'GAP'}`,
        '',
        `- repo: \`${args.repo}\``,
        `- parse duration: ${args.elapsed}s`,
        `- files_parsed: ${m.files_parsed}`,
        `- nodes / edges: ${m.total_nodes} / ${m.total_edges}`,
        `- parse_errors: ${m.parse_errors}`,
        `- extract_errors: ${m.extract_errors}`,
        '',
        '## Verdict',
        '',
        verdict,
        '',
        m.bar_failures.length === 0
            ? '(no bar failures)'
            : '### Bar failures\n\n' + m.bar_failures.map((f) => `- ${f}`).join('\n'),
        '',
        '## Language breakdown (nodes by language)',
        '',
        langBreakdown,
        '',
        '## tier_distribution',
        '',
        '| tier | count |',
        '|---|---|',
        tierLines,
        '',
        '## Quality signals',
        '',
        `- functions with complexity: **${(m.complexity_coverage_ratio * 100).toFixed(1)}%** (${m.fn_count} total)`,
        `- ambiguous edges with alternatives[]: **${(m.alternatives_ratio * 100).toFixed(1)}%** (${m.ambiguous_count} ambiguous)`,
        `- high-confidence CALLS (0.9/0.95): **${m.high_conf_count}** (${(m.high_conf_ratio * 100).toFixed(1)}% of resolved)`,
        `- resolved ratio (resolved / total call sites): **${(m.resolved_ratio * 100).toFixed(1)}%**`,
        '',
        '## Proposed baselines (if promoting to full)',
        '',
        m.passes_full_tier_bar
            ? '```typescript\n' +
              'baseline_tier_ratios: {\n' +
              `    resolved_min: ${Math.max(0, m.resolved_ratio - 0.1).toFixed(2)},\n` +
              `    ambiguous_max: ${Math.min(1, (m.tier_distribution.ambiguous ?? 0) / (m.total_edges || 1) + 0.15).toFixed(2)},\n` +
              `    receiver_min_per_1k_nodes: ${Math.max(0, ((m.tier_distribution.receiver ?? 0) * 1000) / (m.total_nodes || 1) - 2).toFixed(1)},\n` +
              `    di_min_per_1k_nodes: ${Math.max(0, ((m.tier_distribution.di ?? 0) * 1000) / (m.total_nodes || 1) - 2).toFixed(1)},\n` +
              `    high_conf_min_ratio: ${Math.max(0, m.high_conf_ratio - 0.05).toFixed(2)},\n` +
              '},\n' +
              '```'
            : '(skipped — does not clear bar)',
        '',
    ].join('\n');
}

main().catch((err) => {
    console.error('harness crash:', err);
    process.exit(1);
});
