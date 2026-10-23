import { describe, expect, it } from 'bun:test';

import { runCli } from '../helpers/run-cli';

/**
 * Count flags are validated before the command runs.
 *
 * They went through `parseInt`, so `abc` became NaN and `--hub-threshold abc`
 * fell back to 0 (hub damping off) without a word, while `1.5` and `-1` were
 * taken as given.
 */

const CASES: Array<[string, string[]]> = [
    ['--hub-threshold', ['analyze', '--files', 'x.ts', '--out', '-']],
    ['--max-depth', ['analyze', '--files', 'x.ts', '--out', '-']],
    ['--max-callees', ['context', '--files', 'x.ts', '--out', '-']],
    ['--max-functions', ['context', '--files', 'x.ts', '--out', '-']],
    ['--max-files', ['parse', '--all', '--repo-dir', '.', '--out', '/dev/null']],
];

function failure(args: string[]): string {
    try {
        runCli(args);
    } catch (err) {
        return String((err as { stderr?: string }).stderr);
    }
    throw new Error(`expected ${args[0]} to fail`);
}

describe('count flag validation', () => {
    for (const [flag, args] of CASES) {
        for (const bad of ['abc', '1.5', '-1', '']) {
            it(`${args[0]} ${flag} rejects "${bad}"`, () => {
                expect(failure([...args, flag, bad])).toContain(`${flag} must be a non-negative integer`);
            });
        }
    }
});
