import { execFileSync } from 'child_process';
import { resolve } from 'path';

/**
 * Run the CLI from a test, without a shell.
 *
 * `execFileSync` takes an argv array, so nothing is ever parsed by `sh`. The
 * string form — `execSync(\`bun run ${CLI} parse --repo-dir ${FIXTURE}\`)` — put
 * absolute paths through the shell unquoted, so any test using it broke the
 * moment the repo lived somewhere with a space in the path (`~/My Projects/…`),
 * and CodeQL flagged every call site as a command built from environment values.
 *
 * Not a security fix — these paths come from hardcoded literals and `cwd`, and
 * no untrusted input reaches them. The argv form is just correct: no quoting to
 * get wrong, and the finding goes away as a side effect of that.
 */
const CLI = resolve('src/cli.ts');

export interface RunCliOptions {
    /** Capture stdout instead of discarding it (for `--out -` piping tests). */
    capture?: boolean;
}

export function runCli(args: string[], opts: RunCliOptions = {}): string {
    return execFileSync(process.execPath, ['run', CLI, ...args], {
        encoding: 'utf-8',
        // Discard the CLI's stderr progress output; surface it only on failure,
        // which execFileSync attaches to the thrown error.
        stdio: opts.capture ? ['pipe', 'pipe', 'pipe'] : 'pipe',
    });
}
