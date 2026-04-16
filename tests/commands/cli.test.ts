import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'bun';
import { writeFileSync } from 'fs';

const CLI = ['bun', 'src/cli.ts'];
const CWD = '/Users/wellingtonsantana/Documents/kodus-git/kodus-graph';

function runCLI(args: string[]): { code: number; stdout: string; stderr: string } {
    const result = spawnSync({
        cmd: [...CLI, ...args],
        cwd: CWD,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        code: result.exitCode ?? -1,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
    };
}

describe('CLI', () => {
    describe('--help', () => {
        it('shows help when no command given', () => {
            const { stdout } = runCLI(['--help']);
            expect(stdout).toContain('parse');
            expect(stdout).toContain('analyze');
            expect(stdout).toContain('context');
        });

        it('shows version with --version', () => {
            const { stdout } = runCLI(['--version']);
            expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
        });
    });

    describe('parse command', () => {
        it('exits with error when --out is missing', () => {
            const { code, stderr } = runCLI(['parse', '--all', '--repo-dir', '/tmp']);
            expect(code).not.toBe(0);
            expect(stderr).toContain('out');
        });

        it('exits with error when --repo-dir does not exist', () => {
            const { code, stderr } = runCLI([
                'parse',
                '--all',
                '--repo-dir',
                '/nonexistent/xyz',
                '--out',
                '/tmp/test.json',
            ]);
            expect(code).toBe(1);
            expect(stderr).toContain('does not exist');
        });

        it('advertises --max-memory flag in help', () => {
            const { stdout } = runCLI(['parse', '--help']);
            expect(stdout).toContain('--max-memory');
        });
    });

    describe('analyze command', () => {
        it('exits with error when --files is missing', () => {
            const { code, stderr } = runCLI(['analyze', '--out', '/tmp/test.json']);
            expect(code).not.toBe(0);
            expect(stderr).toContain('files');
        });
    });

    describe('context command', () => {
        it('exits with error when --format is invalid', () => {
            const { code, stderr } = runCLI([
                'context',
                '--files',
                'test.ts',
                '--out',
                '/tmp/ctx.json',
                '--format',
                'invalid',
            ]);
            expect(code).toBe(1);
            expect(stderr).toContain('format');
        });

        it('advertises --format json/prompt in help', () => {
            const { stdout } = runCLI(['context', '--help']);
            expect(stdout).toContain('--format');
            expect(stdout).toContain('json');
        });
    });

    describe('diff command', () => {
        it('exits with error when neither --base nor --files given', () => {
            const { code, stderr } = runCLI(['diff', '--out', '/tmp/test.json']);
            expect(code).toBe(1);
            expect(stderr).toMatch(/base|files/);
        });
    });

    describe('search command', () => {
        it('exits with error when no search mode given', () => {
            const tmpFile = '/tmp/test-graph-cli-no-mode.json';
            writeFileSync(tmpFile, '{"nodes":[],"edges":[]}');
            const { code, stderr } = runCLI(['search', '--graph', tmpFile]);
            expect(code).toBe(1);
            expect(stderr).toMatch(/query|callers-of|callees-of/);
        });

        it('exits with error when multiple search modes given', () => {
            const tmpFile = '/tmp/test-graph-cli-multi-mode.json';
            writeFileSync(tmpFile, '{"nodes":[],"edges":[]}');
            const { code, stderr } = runCLI(['search', '--graph', tmpFile, '--query', 'foo', '--callers-of', 'bar']);
            expect(code).toBe(1);
            expect(stderr).toContain('mutually exclusive');
        });
    });

    describe('unknown command', () => {
        it('exits with error for unknown command', () => {
            const { code } = runCLI(['nonexistent-cmd']);
            expect(code).not.toBe(0);
        });
    });

    describe('--out - (stdout mode)', () => {
        it('parse command writes to stdout with --out -', () => {
            const { code, stdout, stderr } = runCLI([
                'parse',
                '--files',
                'src/auth.ts',
                '--repo-dir',
                'tests/fixtures/sample-repo',
                '--out',
                '-',
            ]);
            expect(code).toBe(0);

            // stdout should be valid JSON with metadata/nodes/edges
            const parsed = JSON.parse(stdout);
            expect(parsed).toHaveProperty('metadata');
            expect(parsed).toHaveProperty('nodes');
            expect(parsed).toHaveProperty('edges');
            expect(Array.isArray(parsed.nodes)).toBe(true);
            expect(Array.isArray(parsed.edges)).toBe(true);
            expect(parsed.nodes.length).toBeGreaterThan(0);

            // Info logs should go to stderr (not stdout) so output stays pipe-safe
            expect(stderr).toContain('kodus-graph v');
        });

        it('context command writes prompt to stdout with --out -', () => {
            const { code, stdout } = runCLI([
                'context',
                '--files',
                'src/auth.ts',
                '--repo-dir',
                'tests/fixtures/sample-repo',
                '--format',
                'prompt',
                '--out',
                '-',
            ]);
            expect(code).toBe(0);

            // Prompt format is plain text — verify it looks like a prompt, not JSON
            expect(stdout.length).toBeGreaterThan(0);
            expect(stdout.trimStart().startsWith('{')).toBe(false);
        });
    });
});
