#!/usr/bin/env bun
import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { executeAnalyze } from './commands/analyze';
import { executeCommunities } from './commands/communities';
import { executeContext } from './commands/context';
import { executeContextOf } from './commands/context-of';
import { executeDiff } from './commands/diff';
import { executeFlows } from './commands/flows';
import { executeOutline } from './commands/outline';
import { executeParse } from './commands/parse';
import { executePath } from './commands/path';
import { executePrOverlap } from './commands/pr-overlap';
import { executeRank } from './commands/rank';
import { executeSearch } from './commands/search';
import { executeStatus } from './commands/status';
import { executeSubsystemContext } from './commands/subsystem-context';
import { executeUpdate } from './commands/update';

const program = new Command();

import pkg from '../package.json';
import { DEFAULT_BLAST_MAX_DEPTH } from './shared/constants';
import { log } from './shared/logger';

log.info(`kodus-graph v${pkg.version}`, { node: process.version, platform: process.platform });
program.name('kodus-graph').description('Code graph builder for Kodus code review').version(pkg.version);

program
    .command('parse')
    .description('Parse source files and generate nodes + edges')
    .option('--all', 'Parse all files in repo')
    .option('--files <paths...>', 'Parse specific files')
    .option('--repo-dir <path>', 'Repository root directory', '.')
    .option('--include <glob...>', 'Include only files matching glob (repeatable)')
    .option('--exclude <glob...>', 'Exclude files matching glob (repeatable)')
    .option('--skip-tests', 'Skip test detection (no Test nodes, TESTED_BY edges, or test gaps)')
    .option('--max-memory <mb>', 'Maximum memory usage in MB (default: 768)', (v) => parseInt(v, 10))
    .requiredOption('--out <path>', 'Output JSON file path')
    .action(async (opts) => {
        const repoDir = resolve(opts.repoDir);
        if (!existsSync(repoDir)) {
            log.error('--repo-dir does not exist', { path: repoDir });
            process.exit(1);
        }
        await executeParse({
            repoDir: opts.repoDir,
            files: opts.files,
            all: opts.all ?? false,
            out: opts.out,
            include: opts.include,
            exclude: opts.exclude,
            skipTests: opts.skipTests ?? false,
            maxMemoryMB: opts.maxMemory,
        });
    });

program
    .command('analyze')
    .description('Compute blast radius, risk score, and test gaps')
    .requiredOption('--files <paths...>', 'Changed files to analyze')
    .option('--repo-dir <path>', 'Repository root directory', '.')
    .option('--graph <path>', 'Path to main graph JSON')
    .option('--max-depth <n>', 'Blast radius BFS depth', String(DEFAULT_BLAST_MAX_DEPTH))
    .option('--skip-tests', 'Skip test detection (no TESTED_BY edges or test gaps)')
    .option('--risk-config <path>', 'Path to JSON file overriding risk-score weights and caps')
    .requiredOption('--out <path>', 'Output JSON file path')
    .action(async (opts) => {
        const repoDir = resolve(opts.repoDir);
        if (!existsSync(repoDir)) {
            log.error('--repo-dir does not exist', { path: repoDir });
            process.exit(1);
        }
        await executeAnalyze({
            repoDir: opts.repoDir,
            files: opts.files,
            graph: opts.graph,
            out: opts.out,
            skipTests: opts.skipTests ?? false,
            riskConfig: opts.riskConfig,
            maxDepth: Number.parseInt(opts.maxDepth, 10),
        });
    });

program
    .command('context')
    .description('Generate enriched review context for agents')
    .requiredOption('--files <paths...>', 'Changed files')
    .option('--repo-dir <path>', 'Repository root directory', '.')
    .option('--graph <path>', 'Path to main graph JSON')
    .option('--diff <path>', 'Path to unified diff file (filters changed functions in fallback mode)')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--min-confidence <n>', 'Minimum CALLS edge confidence', '0.5')
    .option('--max-depth <n>', 'Blast radius BFS depth', String(DEFAULT_BLAST_MAX_DEPTH))
    .option('--format <type>', 'Output format: json, prompt, or xml', 'json')
    .option('--skip-tests', 'Skip test detection (no Test nodes, TESTED_BY edges, or test gaps)')
    .option('--max-functions <n>', 'Max changed functions in prompt output (default: 30)', (v) => parseInt(v, 10))
    .option(
        '--max-prompt-chars <n>',
        'Max total prompt chars — truncates less important sections first (default: 20000)',
        (v) => parseInt(v, 10),
    )
    .option('--risk-config <path>', 'Path to JSON file overriding risk-score weights and caps')
    .action(async (opts) => {
        const repoDir = resolve(opts.repoDir);
        if (!existsSync(repoDir)) {
            log.error('--repo-dir does not exist', { path: repoDir });
            process.exit(1);
        }
        if (opts.format !== 'json' && opts.format !== 'prompt' && opts.format !== 'xml') {
            log.error('--format must be "json", "prompt", or "xml"', { got: opts.format });
            process.exit(1);
        }
        await executeContext({
            repoDir: opts.repoDir,
            files: opts.files,
            graph: opts.graph,
            diff: opts.diff,
            out: opts.out,
            minConfidence: Number.parseFloat(opts.minConfidence),
            maxDepth: Number.parseInt(opts.maxDepth, 10),
            format: opts.format,
            skipTests: opts.skipTests ?? false,
            maxFunctions: opts.maxFunctions,
            maxPromptChars: opts.maxPromptChars,
            riskConfig: opts.riskConfig,
        });
    });

program
    .command('diff')
    .description('Compare changed files against an existing graph')
    .option('--base <ref>', 'Git ref to diff against')
    .option('--files <paths...>', 'Explicit list of changed files')
    .option('--repo-dir <path>', 'Repository root directory', '.')
    .option('--graph <path>', 'Previous graph JSON', '.kodus-graph/graph.json')
    .requiredOption('--out <path>', 'Output JSON file path')
    .action(async (opts) => {
        if (!opts.base && !opts.files) {
            log.error('one of --base or --files is required');
            process.exit(1);
        }
        const repoDir = resolve(opts.repoDir);
        if (!existsSync(repoDir)) {
            log.error('--repo-dir does not exist', { path: repoDir });
            process.exit(1);
        }
        await executeDiff({
            repoDir: opts.repoDir,
            base: opts.base,
            files: opts.files,
            graph: opts.graph,
            out: opts.out,
        });
    });

program
    .command('update')
    .description('Incrementally update graph (only re-parse changed files)')
    .option('--repo-dir <path>', 'Repository root directory', '.')
    .option('--graph <path>', 'Previous graph JSON (default: .kodus-graph/graph.json)')
    .option('--out <path>', 'Output path (default: same as --graph)')
    .action(async (opts) => {
        const repoDir = resolve(opts.repoDir);
        if (!existsSync(repoDir)) {
            log.error('--repo-dir does not exist', { path: repoDir });
            process.exit(1);
        }
        await executeUpdate({
            repoDir: opts.repoDir,
            graph: opts.graph,
            out: opts.out,
        });
    });

program
    .command('communities')
    .description('Detect module clusters and coupling between them')
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--min-size <n>', 'Minimum nodes per community', '2')
    .option('--depth <n>', 'Directory grouping depth (directory mode)', '2')
    .option(
        '--topological',
        'Cluster by call-graph topology (Louvain modularity) with hubs + bridges, instead of directory',
    )
    .option('--top <n>', 'Hubs/bridges to report in topological mode', '10')
    .action((opts) => {
        executeCommunities({
            graph: opts.graph,
            out: opts.out,
            minSize: parseInt(opts.minSize, 10),
            depth: parseInt(opts.depth, 10),
            topological: Boolean(opts.topological),
            topN: parseInt(opts.top, 10),
        });
    });

program
    .command('pr-overlap')
    .description('Compare two changesets (PRs) for merge risk and cross-impact')
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--a <qualified...>', "PR A's changed symbols (qualified names)")
    .option('--b <qualified...>', "PR B's changed symbols (qualified names)")
    .option('--a-files <paths...>', "PR A's changed files (expanded to their symbols if --a is omitted)")
    .option('--b-files <paths...>', "PR B's changed files (expanded to their symbols if --b is omitted)")
    .option('--max-depth <n>', 'Blast radius BFS depth', String(DEFAULT_BLAST_MAX_DEPTH))
    .option('--min-confidence <n>', 'Minimum CALLS edge confidence', '0.5')
    .action((opts) => {
        if (!opts.a && !opts.aFiles) {
            log.error('one of --a or --a-files is required');
            process.exit(1);
        }
        if (!opts.b && !opts.bFiles) {
            log.error('one of --b or --b-files is required');
            process.exit(1);
        }
        executePrOverlap({
            graph: opts.graph,
            out: opts.out,
            a: opts.a,
            b: opts.b,
            aFiles: opts.aFiles,
            bFiles: opts.bFiles,
            maxDepth: Number.parseInt(opts.maxDepth, 10),
            minConfidence: Number.parseFloat(opts.minConfidence),
        });
    });

program
    .command('subsystem-context')
    .description('Orient a changeset: its module(s), hub/bridge role, and immediate callers/callees')
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--changed <qualified...>', 'Changed symbols (qualified names)')
    .option('--files <paths...>', 'Changed files (expanded to their symbols if --changed is omitted)')
    .option('--top <n>', 'Hub/bridge pool size considered notable', '20')
    .option('--min-size <n>', 'Minimum community size to report as a subsystem', '2')
    .action((opts) => {
        if (!opts.changed && !opts.files) {
            log.error('one of --changed or --files is required');
            process.exit(1);
        }
        executeSubsystemContext({
            graph: opts.graph,
            out: opts.out,
            changed: opts.changed,
            files: opts.files,
            topN: parseInt(opts.top, 10),
            minSize: parseInt(opts.minSize, 10),
        });
    });

program
    .command('context-of')
    .description("A symbol's context pack: callers, callees, types, and tests, ranked, in one query")
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .requiredOption('--symbol <qualified>', 'Qualified name of the symbol')
    .option('--limit <n>', 'Max neighbours per list, most-connected first', '15')
    .action((opts) => {
        executeContextOf({
            graph: opts.graph,
            out: opts.out,
            symbol: opts.symbol,
            limit: parseInt(opts.limit, 10),
        });
    });

program
    .command('path')
    .description('Shortest call path between two symbols ("how does A reach B?")')
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .requiredOption('--from <qualified>', 'Origin symbol (qualified name)')
    .requiredOption('--to <qualified>', 'Destination symbol (qualified name)')
    .option('--kinds <kind...>', 'Edge kinds that count as a hop (default: CALLS)')
    .option('--max-depth <n>', 'Give up after this many hops', '10')
    .action((opts) => {
        executePath({
            graph: opts.graph,
            out: opts.out,
            from: opts.from,
            to: opts.to,
            kinds: opts.kinds,
            maxDepth: Number.parseInt(opts.maxDepth, 10),
        });
    });

program
    .command('rank')
    .description('Rank symbols by structural importance (degree) for relevance-ordered retrieval')
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--top <n>', 'How many symbols to return', '20')
    .option('--file <path>', 'Restrict to symbols declared in this file')
    .option('--kind <type>', 'Restrict to a node kind (Function, Class, Interface, ...)')
    .action((opts) => {
        executeRank({
            graph: opts.graph,
            out: opts.out,
            top: parseInt(opts.top, 10),
            file: opts.file,
            kind: opts.kind,
        });
    });

program
    .command('status')
    .description("Check whether the graph is still fresh against the repo's files on disk")
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--repo-dir <path>', 'Repository root the graph paths resolve against', '.')
    .action((opts) => {
        executeStatus({
            graph: opts.graph,
            out: opts.out,
            repoDir: opts.repoDir,
        });
    });

program
    .command('flows')
    .description('Detect entry points and trace execution paths')
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .requiredOption('--out <path>', 'Output JSON file path')
    .option('--max-depth <n>', 'Max BFS trace depth', '10')
    .option('--type <kind>', 'Filter: test, http, all', 'all')
    .action((opts) => {
        executeFlows({
            graph: opts.graph,
            out: opts.out,
            maxDepth: parseInt(opts.maxDepth, 10),
            type: opts.type as 'test' | 'http' | 'all',
        });
    });

program
    .command('search')
    .description('Search the graph by name, kind, file, or relations')
    .requiredOption('--graph <path>', 'Path to graph JSON')
    .option('--query <pattern>', 'Search by name/qualified_name (glob or /regex/)')
    .option('--kind <type>', 'Filter by kind: Function, Method, Class, Interface, Enum, Test')
    .option('--file <pattern>', 'Filter by file path (glob)')
    .option('--callers-of <qualified>', 'Find callers of this node')
    .option('--callees-of <qualified>', 'Find callees of this node')
    .option('--limit <n>', 'Max results', '50')
    .option('--out <path>', 'Output file (default: stdout)')
    .action((opts) => {
        const modes = [opts.query, opts.callersOf, opts.calleesOf].filter(Boolean).length;
        if (modes === 0) {
            log.error('one of --query, --callers-of, or --callees-of is required');
            process.exit(1);
        }
        if (modes > 1) {
            log.error('--query, --callers-of, and --callees-of are mutually exclusive');
            process.exit(1);
        }
        executeSearch({
            graph: opts.graph,
            query: opts.query,
            kind: opts.kind,
            file: opts.file,
            callersOf: opts.callersOf,
            calleesOf: opts.calleesOf,
            limit: parseInt(opts.limit, 10),
            out: opts.out,
        });
    });

program
    .command('outline')
    .description('Print a compact structural outline of files (symbols, signatures, ranges)')
    .option('--files <paths...>', 'Files to outline (relative to --repo-dir)')
    .option('--dir <path>', 'Outline every source file under this directory')
    .option('--repo-dir <path>', 'Repository root', '.')
    .option('--format <fmt>', 'Output format: text or json', 'text')
    .option('--exported-only', 'Only show exported symbols')
    .option('--graph <path>', 'Resolved graph JSON — enrich symbols with CALLS fan-in/fan-out')
    .option('--blast', "With --graph, also compute each symbol's blast-radius size")
    .option('--max-depth <n>', 'Blast-radius traversal depth', String(DEFAULT_BLAST_MAX_DEPTH))
    .option('--include <patterns...>', 'Glob(s) to include')
    .option('--exclude <patterns...>', 'Glob(s) to exclude')
    .option('--out <path>', 'Output file (default: stdout)', '-')
    .action((opts) => {
        if (!opts.files && !opts.dir) {
            log.error('one of --files or --dir is required');
            process.exit(1);
        }
        if (opts.format !== 'text' && opts.format !== 'json') {
            log.error("--format must be 'text' or 'json'");
            process.exit(1);
        }
        if (opts.blast && !opts.graph) {
            log.error('--blast requires --graph');
            process.exit(1);
        }
        executeOutline({
            repoDir: resolve(opts.repoDir),
            files: opts.files,
            dir: opts.dir ? resolve(opts.dir) : undefined,
            format: opts.format,
            exportedOnly: opts.exportedOnly,
            graph: opts.graph,
            blast: opts.blast,
            maxDepth: parseInt(opts.maxDepth, 10),
            include: opts.include,
            exclude: opts.exclude,
            out: opts.out,
        });
    });

program.parseAsync().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error(message);
    process.exit(1);
});
