import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { executeParse } from '../../src/commands/parse';
import { SCHEMA_VERSION } from '../../src/shared/constants';
import { parseMetadataSchema } from '../../src/shared/schemas';

// Import to trigger language registration
import '../../src/parser/languages';

describe('schema versioning', () => {
    it('exposes SCHEMA_VERSION as a non-empty string', () => {
        expect(typeof SCHEMA_VERSION).toBe('string');
        expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
    });

    it('parseMetadataSchema accepts schema_version', () => {
        const parsed = parseMetadataSchema.parse({
            repo_dir: '.',
            files_parsed: 1,
            total_nodes: 0,
            total_edges: 0,
            duration_ms: 1,
            parse_errors: 0,
            extract_errors: 0,
            schema_version: SCHEMA_VERSION,
        });
        expect(parsed.schema_version).toBe(SCHEMA_VERSION);
    });

    it('parseMetadataSchema still accepts metadata without schema_version (back-compat)', () => {
        const parsed = parseMetadataSchema.parse({
            repo_dir: '.',
            files_parsed: 1,
            total_nodes: 0,
            total_edges: 0,
            duration_ms: 1,
            parse_errors: 0,
            extract_errors: 0,
        });
        expect(parsed.schema_version).toBeUndefined();
    });

    it('executeParse stamps SCHEMA_VERSION into emitted metadata', async () => {
        const fixtureDir = resolve('tests/fixtures/sample-repo');
        const tmpDir = mkdtempSync(join(tmpdir(), 'kodus-graph-schema-version-'));
        const outPath = join(tmpDir, 'parse-output.json');

        try {
            await executeParse({
                repoDir: fixtureDir,
                files: ['src/auth.ts'],
                all: false,
                out: outPath,
            });

            const output = JSON.parse(readFileSync(outPath, 'utf-8'));
            expect(output.metadata.schema_version).toBe(SCHEMA_VERSION);
        } finally {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
