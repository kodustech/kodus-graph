#!/usr/bin/env bun
import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { executeParse } from './commands/parse';
import { executeAnalyze } from './commands/analyze';
import { executeContext } from './commands/context';

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
  .requiredOption('--out <path>', 'Output JSON file path')
  .action(async (opts) => {
    const repoDir = resolve(opts.repoDir);
    if (!existsSync(repoDir)) {
      process.stderr.write(`Error: --repo-dir does not exist: ${repoDir}\n`);
      process.exit(1);
    }
    await executeParse({
      repoDir: opts.repoDir,
      files: opts.files,
      all: opts.all ?? false,
      out: opts.out,
    });
  });

program
  .command('analyze')
  .description('Compute blast radius, risk score, and test gaps')
  .requiredOption('--files <paths...>', 'Changed files to analyze')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--graph <path>', 'Path to main graph JSON')
  .requiredOption('--out <path>', 'Output JSON file path')
  .action(async (opts) => {
    const repoDir = resolve(opts.repoDir);
    if (!existsSync(repoDir)) {
      process.stderr.write(`Error: --repo-dir does not exist: ${repoDir}\n`);
      process.exit(1);
    }
    await executeAnalyze({
      repoDir: opts.repoDir,
      files: opts.files,
      graph: opts.graph,
      out: opts.out,
    });
  });

program
  .command('context')
  .description('Generate enriched review context for agents')
  .requiredOption('--files <paths...>', 'Changed files')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--graph <path>', 'Path to main graph JSON')
  .requiredOption('--out <path>', 'Output JSON file path')
  .action(async (opts) => {
    const repoDir = resolve(opts.repoDir);
    if (!existsSync(repoDir)) {
      process.stderr.write(`Error: --repo-dir does not exist: ${repoDir}\n`);
      process.exit(1);
    }
    await executeContext({
      repoDir: opts.repoDir,
      files: opts.files,
      graph: opts.graph,
      out: opts.out,
    });
  });

program.parse();
