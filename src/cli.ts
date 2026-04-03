#!/usr/bin/env bun
import { Command } from 'commander';

const program = new Command();

program
  .name('kodus-graph')
  .description('Code graph builder for Kodus code review')
  .version('0.1.0');

program
  .command('parse')
  .description('Parse source files and generate nodes + edges')
  .option('--all', 'Parse all files in repo')
  .option('--files <paths...>', 'Parse specific files')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--out <path>', 'Output JSON file path', '/tmp/kodus-graph-parse.json')
  .action(async (opts) => {
    console.log('parse command — not yet implemented');
    process.exit(1);
  });

program
  .command('analyze')
  .description('Compute blast radius, risk score, and test gaps')
  .requiredOption('--files <paths...>', 'Changed files to analyze')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--graph <path>', 'Path to main graph JSON')
  .option('--out <path>', 'Output JSON file path', '/tmp/kodus-graph-analysis.json')
  .action(async (opts) => {
    console.log('analyze command — not yet implemented');
    process.exit(1);
  });

program
  .command('context')
  .description('Generate enriched review context for agents')
  .requiredOption('--files <paths...>', 'Changed files')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--graph <path>', 'Path to main graph JSON')
  .option('--out <path>', 'Output JSON file path', '/tmp/kodus-graph-context.json')
  .action(async (opts) => {
    console.log('context command — not yet implemented');
    process.exit(1);
  });

program.parse();
