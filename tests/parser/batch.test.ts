import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { parseBatch } from '../../src/parser/batch';

// Import to trigger language registration
import '../../src/parser/languages';

describe('parseBatch', () => {
    it('should parse fixture files and return raw graph', async () => {
        const fixtureDir = resolve('tests/fixtures/sample-repo');
        const files = [
            resolve(fixtureDir, 'src/auth.ts'),
            resolve(fixtureDir, 'src/controller.ts'),
            resolve(fixtureDir, 'src/db.ts'),
        ];

        const result = await parseBatch(files, fixtureDir);

        expect(result.functions.length).toBeGreaterThan(0);
        expect(result.classes.length).toBeGreaterThan(0);
        expect(result.imports.length).toBeGreaterThan(0);
    });
});
