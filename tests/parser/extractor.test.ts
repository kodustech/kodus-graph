import { describe, expect, it } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { RawGraph } from '../../src/graph/types';
import { extractFromFile } from '../../src/parser/extractor';

// Import to trigger language registration side-effect
import '../../src/parser/languages';

describe('extractFromFile (Ruby)', () => {
    it('should extract singleton methods (def self.method_name)', async () => {
        const source = `
class TopicEmbed
  def self.import(url, contents)
    # class method
  end

  def self.find_remote(url)
    # another class method
  end

  def instance_method
    # regular method
  end
end
`;
        const root = await parseAsync('ruby' as any, source);
        const graph = emptyGraph();
        const seen = new Set<string>();

        extractFromFile(root, 'test.rb', 'ruby', seen, graph);

        expect(graph.functions.some((f) => f.name === 'import')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'find_remote')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'instance_method')).toBe(true);

        const importFn = graph.functions.find((f) => f.name === 'import');
        expect(importFn!.className).toBe('TopicEmbed');
        expect(importFn!.kind).toBe('Method');
        expect(importFn!.qualified).toBe('test.rb::TopicEmbed.import');

        const findRemoteFn = graph.functions.find((f) => f.name === 'find_remote');
        expect(findRemoteFn!.className).toBe('TopicEmbed');
        expect(findRemoteFn!.qualified).toBe('test.rb::TopicEmbed.find_remote');
    });
});

function emptyGraph(): RawGraph {
    return {
        functions: [],
        classes: [],
        interfaces: [],
        enums: [],
        tests: [],
        imports: [],
        reExports: [],
        rawCalls: [],
        diMaps: new Map(),
    };
}

describe('extractFromFile (TypeScript)', () => {
    it('should extract functions, classes, interfaces from auth.ts', async () => {
        const filePath = resolve('tests/fixtures/sample-repo/src/auth.ts');
        const source = readFileSync(filePath, 'utf-8');
        const root = await parseAsync(Lang.TypeScript, source);
        const graph = emptyGraph();
        const seen = new Set<string>();

        extractFromFile(root, 'src/auth.ts', Lang.TypeScript, seen, graph);

        // Should find: AuthService class
        expect(graph.classes.some((c) => c.name === 'AuthService')).toBe(true);
        // Should find: AuthConfig interface
        expect(graph.interfaces.some((i) => i.name === 'AuthConfig')).toBe(true);
        // Should find: authenticate method, verifyToken method
        expect(graph.functions.some((f) => f.name === 'authenticate')).toBe(true);
        expect(graph.functions.some((f) => f.name === 'verifyToken')).toBe(true);
        // Should find: hashPassword standalone function
        expect(graph.functions.some((f) => f.name === 'hashPassword')).toBe(true);
        // Should find: validateEmail arrow function
        expect(graph.functions.some((f) => f.name === 'validateEmail')).toBe(true);
        // Should find: import
        expect(graph.imports.some((i) => i.module === './db')).toBe(true);
    });

    it('should extract DI map from controller.ts constructor', async () => {
        const filePath = resolve('tests/fixtures/sample-repo/src/controller.ts');
        const source = readFileSync(filePath, 'utf-8');
        const root = await parseAsync(Lang.TypeScript, source);
        const graph = emptyGraph();
        const seen = new Set<string>();

        extractFromFile(root, 'src/controller.ts', Lang.TypeScript, seen, graph);

        const diMap = graph.diMaps.get('src/controller.ts');
        expect(diMap).toBeDefined();
        expect(diMap!.get('authService')).toBe('AuthService');
        expect(diMap!.get('userService')).toBe('UserService');
    });

    it('should extract tests from test file', async () => {
        const filePath = resolve('tests/fixtures/sample-repo/tests/auth.test.ts');
        const source = readFileSync(filePath, 'utf-8');
        const root = await parseAsync(Lang.TypeScript, source);
        const graph = emptyGraph();
        const seen = new Set<string>();

        extractFromFile(root, 'tests/auth.test.ts', Lang.TypeScript, seen, graph);

        expect(graph.tests.length).toBeGreaterThanOrEqual(2);
        expect(graph.tests.some((t) => t.name === 'should authenticate valid user')).toBe(true);
    });
});
