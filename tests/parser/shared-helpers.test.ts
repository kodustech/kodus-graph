import { describe, expect, it } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
import type { ExportRules } from '../../src/languages/shared';
import { extractDecorators, extractThrows, isAsync, isExported } from '../../src/languages/shared';

describe('isExported', () => {
    it('should detect export keyword via parent node', async () => {
        const source = `export function hello() {}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        const rules: ExportRules = {
            exportKeywords: ['export_statement', 'export'],
        };
        expect(isExported('hello', funcNode, rules)).toBe(true);
    });

    it('should return false when not exported', async () => {
        const source = `function hello() {}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        const rules: ExportRules = {
            exportKeywords: ['export_statement', 'export'],
        };
        expect(isExported('hello', funcNode, rules)).toBe(false);
    });

    it('should detect export via modifier keywords', async () => {
        const source = `public class Foo {}`;
        const root = await parseAsync('java', source);
        const classNode = root.root().findAll({ rule: { kind: 'class_declaration' } })[0];
        expect(classNode).toBeTruthy();

        const rules: ExportRules = {
            modifierKeywords: ['public'],
        };
        expect(isExported('Foo', classNode, rules)).toBe(true);
    });

    it('should detect export via custom check', async () => {
        const source = `function Hello() {}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        const rules: ExportRules = {
            customCheck: (name) => name[0] === name[0].toUpperCase(),
        };
        expect(isExported('Hello', funcNode, rules)).toBe(true);
        expect(isExported('hello', funcNode, rules)).toBe(false);
    });
});

describe('isAsync', () => {
    it('should detect async keyword on a function', async () => {
        const source = `async function fetchData() {}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        expect(isAsync(funcNode)).toBe(true);
    });

    it('should return false for sync functions', async () => {
        const source = `function syncData() {}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        expect(isAsync(funcNode)).toBe(false);
    });
});

describe('extractDecorators', () => {
    it('should find decorator siblings in TypeScript', async () => {
        const source = `
class Foo {
    @Get('/')
    handleRequest() {}
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const methods = root.root().findAll({ rule: { kind: 'method_definition' } });
        expect(methods.length).toBeGreaterThan(0);

        const decorators = extractDecorators(methods[0], ['decorator']);
        expect(decorators.length).toBeGreaterThan(0);
        expect(decorators[0]).toContain('@Get');
    });

    it('should return empty array when no decorators', async () => {
        const source = `
class Foo {
    handleRequest() {}
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const methods = root.root().findAll({ rule: { kind: 'method_definition' } });
        expect(methods.length).toBeGreaterThan(0);

        const decorators = extractDecorators(methods[0], ['decorator']);
        expect(decorators).toEqual([]);
    });

    it('should return empty array when decorator kinds list is empty', async () => {
        const source = `
class Foo {
    @Get('/')
    handleRequest() {}
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const methods = root.root().findAll({ rule: { kind: 'method_definition' } });
        expect(methods.length).toBeGreaterThan(0);

        const decorators = extractDecorators(methods[0], []);
        expect(decorators).toEqual([]);
    });
});

describe('extractThrows', () => {
    it('should find throw statements in function body', async () => {
        const source = `
function validate(x: number) {
    if (x < 0) {
        throw new ValidationError("negative");
    }
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        const throws = extractThrows(funcNode, ['throw_statement']);
        expect(throws.length).toBeGreaterThan(0);
        expect(throws[0]).toBe('ValidationError');
    });

    it('should return empty array when no throws', async () => {
        const source = `function ok() { return 42; }`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        const throws = extractThrows(funcNode, ['throw_statement']);
        expect(throws).toEqual([]);
    });

    it('should return empty array when throw kinds list is empty', async () => {
        const source = `
function fail() {
    throw new Error("boom");
}`;
        const root = await parseAsync(Lang.TypeScript, source);
        const funcNode = root.root().findAll({ rule: { kind: 'function_declaration' } })[0];
        expect(funcNode).toBeTruthy();

        const throws = extractThrows(funcNode, []);
        expect(throws).toEqual([]);
    });
});
