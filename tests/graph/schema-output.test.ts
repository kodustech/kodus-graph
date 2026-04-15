import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { executeParse } from '../../src/commands/parse';
import { graphDataSchema } from '../../src/shared/schemas';

const TMP = join(import.meta.dir, '../fixtures/schema-output-tmp');

describe('Graph output validates against schema (e2e)', () => {
    beforeAll(() => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'src'), { recursive: true });
        writeFileSync(join(TMP, 'package.json'), JSON.stringify({ name: 'test' }));
        writeFileSync(
            join(TMP, 'tsconfig.json'),
            JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
        );

        writeFileSync(
            join(TMP, 'src/user.ts'),
            `export interface User { id: number; name: string; }
export class UserService {
    async getUser(id: number): Promise<User | null> {
        if (!id) throw new Error("invalid");
        return null;
    }
}
`,
        );
    });

    afterAll(() => {
        rmSync(TMP, { recursive: true, force: true });
    });

    it('parse output validates against graphDataSchema', async () => {
        const outFile = join(TMP, 'graph.json');
        await executeParse({
            repoDir: TMP,
            all: true,
            out: outFile,
        });

        const data = JSON.parse(readFileSync(outFile, 'utf-8'));
        const result = graphDataSchema.safeParse(data);

        if (!result.success) {
            // Surface zod issues for easier debugging when the test fails.
            // eslint-disable-next-line no-console
            console.error(result.error.issues);
        }
        expect(result.success).toBe(true);

        // Sanity: the fixture should produce at least the class/method nodes.
        expect(data.metadata.files_parsed).toBeGreaterThan(0);
        expect(Array.isArray(data.nodes)).toBe(true);
        expect(Array.isArray(data.edges)).toBe(true);
        expect(data.nodes.length).toBeGreaterThan(0);
    });
});
