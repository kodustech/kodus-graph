import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseBatch } from '../../src/parser/batch';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';
import { diScopedKey } from '../../src/shared/qualified-name';

// Trigger language registration.
import '../../src/parser/languages';

// Two services in ONE file inject a same-named field (`repo`) of DIFFERENT
// types. The file-scoped diMap's bare `repo` key is last-write-wins
// (OrderRepo), so without per-class scoping BOTH `this.repo.find()` calls
// resolve to OrderRepo.find. With it, each resolves to its own class's type.
const JAVA_SRC = `package com.x;

class UserRepo { void find() {} }
class OrderRepo { void find() {} }

class UserService {
    private final UserRepo repo;
    UserService(UserRepo repo) { this.repo = repo; }
    void run() { this.repo.find(); }
}

class OrderService {
    private final OrderRepo repo;
    OrderService(OrderRepo repo) { this.repo = repo; }
    void run() { this.repo.find(); }
}
`;

describe('per-class diMap scoping (Java)', () => {
    it('resolves same-named DI fields in two same-file classes to their own types', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kg-di-per-class-'));
        const rel = 'Services.java';
        writeFileSync(join(dir, rel), JAVA_SRC);

        try {
            const rawGraph = await parseBatch([join(dir, rel)], dir);

            // The diMap carries the bare (last-write) key AND both per-class keys.
            const diMap = rawGraph.diMaps.get(rel);
            expect(diMap).toBeDefined();
            expect(diMap?.get(diScopedKey('UserService', 'repo'))).toBe('UserRepo');
            expect(diMap?.get(diScopedKey('OrderService', 'repo'))).toBe('OrderRepo');

            // Each DI call site carries its enclosing class.
            const diCalls = rawGraph.rawCalls.filter((c) => c.diField === 'repo' && c.callName === 'find');
            expect(diCalls).toHaveLength(2);
            expect(new Set(diCalls.map((c) => c.diClass))).toEqual(new Set(['UserService', 'OrderService']));

            // Resolve and confirm BOTH targets appear — proof the calls didn't
            // both collapse onto the last-write bare key.
            const symbolTable = createSymbolTable();
            for (const f of rawGraph.functions) {
                symbolTable.add(f.file, f.name, f.qualified);
            }
            for (const c of rawGraph.classes) {
                symbolTable.add(c.file, c.name, c.qualified);
            }
            const { callEdges } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, createImportMap());

            const diTargets = callEdges
                .filter((e) => e.callName === 'find' && e.confidence >= 0.9)
                .map((e) => e.target);
            expect(diTargets.some((t) => t.includes('UserRepo.find'))).toBe(true);
            expect(diTargets.some((t) => t.includes('OrderRepo.find'))).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
