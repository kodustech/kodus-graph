import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { parseBatch } from '../../src/parser/batch';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';

// Trigger language registration
import '../../src/parser/languages';

describe('DI flow: extraction → parseBatch → resolveAllCalls', () => {
    const fixtureDir = resolve('tests/fixtures/sample-repo');

    it('should extract DI maps from constructor and resolve this.field.method calls', async () => {
        const files = [
            resolve(fixtureDir, 'src/auth.ts'),
            resolve(fixtureDir, 'src/controller.ts'),
            resolve(fixtureDir, 'src/db.ts'),
        ];

        // Phase 1: parseBatch extracts structures + rawCalls + diMaps
        const rawGraph = await parseBatch(files, fixtureDir);

        // Verify DI maps were extracted from controller.ts constructor
        const controllerDI = rawGraph.diMaps.get('src/controller.ts');
        expect(controllerDI).toBeDefined();
        expect(controllerDI!.get('authService')).toBe('AuthService');

        // Verify rawCalls include DI call with diField
        const diCall = rawGraph.rawCalls.find((c) => c.source === 'src/controller.ts' && c.diField === 'authService');
        expect(diCall).toBeDefined();
        expect(diCall!.callName).toBe('authenticate');

        // Phase 2: Build symbol table + import map
        const symbolTable = createSymbolTable();
        for (const f of rawGraph.functions) {
            symbolTable.add(f.file, f.name, f.qualified);
        }
        for (const c of rawGraph.classes) {
            symbolTable.add(c.file, c.name, c.qualified);
        }

        const importMap = createImportMap();
        // Simulate import resolution (controller imports AuthService from auth)
        importMap.add('src/controller.ts', 'AuthService', 'src/auth.ts');

        // Phase 3: resolveAllCalls — should resolve DI call at high confidence
        const { callEdges, stats } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);

        // Verify DI resolution produced an edge with 0.95 confidence
        const diEdge = callEdges.find(
            (e) => e.source === 'src/controller.ts' && e.callName === 'authenticate' && e.confidence >= 0.9,
        );
        expect(diEdge).toBeDefined();
        expect(diEdge!.target).toContain('AuthService.authenticate');
        expect(stats.di).toBeGreaterThanOrEqual(1);
    });

    it('should include parseErrors and extractErrors in result', async () => {
        const files = [resolve(fixtureDir, 'src/auth.ts')];
        const result = await parseBatch(files, fixtureDir);

        expect(result.parseErrors).toBe(0);
        expect(result.extractErrors).toBe(0);
    });
});
