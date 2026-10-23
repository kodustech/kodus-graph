import { describe, expect, it } from 'bun:test';

import { runCli } from '../helpers/run-cli';

/**
 * Every `--min-confidence` is validated before the command runs.
 *
 * Only `parse` checked it. The others passed it through `parseFloat`, so `abc`
 * became NaN and every `(confidence ?? 1) >= NaN` was false: `context-of`
 * silently reported no callers and no callees.
 */

const COMMANDS: Record<string, string[]> = {
    parse: ['parse', '--all', '--repo-dir', '.', '--out', '/dev/null'],
    context: ['context', '--files', 'x.ts', '--out', '-'],
    'pr-overlap': ['pr-overlap', '--graph', 'g.json', '--out', '-', '--a', 'x', '--b', 'y'],
    'context-of': ['context-of', '--graph', 'g.json', '--out', '-', '--symbol', 'x.ts::x'],
};

function failure(args: string[]): string {
    try {
        runCli(args);
    } catch (err) {
        return String((err as { stderr?: string }).stderr);
    }
    throw new Error(`expected ${args[0]} to fail`);
}

describe('--min-confidence validation', () => {
    for (const [name, args] of Object.entries(COMMANDS)) {
        for (const bad of ['abc', '2', '-0.1']) {
            it(`${name} rejects ${bad}`, () => {
                expect(failure([...args, '--min-confidence', bad])).toContain('between 0 and 1');
            });
        }
    }
});
