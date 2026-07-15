import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';

import { parseBatch } from '../../src/parser/batch';
import { discoverFiles } from '../../src/parser/discovery';
import { resolveAllCalls, resolveCallsForGraph } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../../src/resolver/import-resolver';
import { createSymbolTable } from '../../src/resolver/symbol-table';

/**
 * `resolveAllCalls`'s last three parameters are optional and default to empty
 * maps. Omitting them does not fail — it silently disables the receiver tier's
 * inheritance fallback, the chained-call pass, and `@IMPORT:`/`@CALLEE:`
 * deferred resolution. `parse` passed all seven; `analyze`, `diff` and `update`
 * passed four, so three of four commands resolved the same repo differently and
 * the only visible trace was `receiver: 0` in a tier distribution nobody read.
 *
 * `resolveCallsForGraph` derives those inputs from the RawGraph so there is
 * nothing to forget. These tests pin both halves of that claim: the degraded
 * call really does lose edges (so the bug was real), and every command now goes
 * through the safe entry point (so it cannot come back).
 */

const FIXTURE = resolve('tests/fixtures/receiver-tier-repo');

async function buildInputs(repoDir: string = FIXTURE) {
    const files = discoverFiles(repoDir, undefined);
    const rawGraph = await parseBatch(files, repoDir, {});

    const tsconfigAliases = loadTsconfigAliases(repoDir);
    const symbolTable = createSymbolTable();
    const importMap = createImportMap();

    for (const f of rawGraph.functions) {
        symbolTable.add(f.file, f.name, f.qualified);
    }
    for (const c of rawGraph.classes) {
        symbolTable.add(c.file, c.name, c.qualified);
    }
    for (const i of rawGraph.interfaces) {
        symbolTable.add(i.file, i.name, i.qualified);
    }

    for (const imp of rawGraph.imports) {
        const resolved = resolveImport(resolve(repoDir, imp.file), imp.module, imp.lang, repoDir, tsconfigAliases);
        const target = resolved ? resolve(repoDir, resolved).replace(`${repoDir}/`, '') : imp.module;
        for (const name of imp.names) {
            importMap.add(imp.file, name, target);
        }
    }

    return { rawGraph, symbolTable, importMap };
}

describe('resolveCallsForGraph', () => {
    it('reaches the receiver tier for an inherited method, which the 4-argument call cannot', async () => {
        const { rawGraph, symbolTable, importMap } = await buildInputs();

        const full = resolveCallsForGraph(rawGraph, symbolTable, importMap);
        // How analyze.ts / diff.ts / update.ts used to call it.
        const degraded = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);

        const inherited = (r: { callEdges: Array<{ target: string }> }) =>
            r.callEdges.find((e) => e.target === 'src/base.ts::BaseRepository.save');

        // `persistUser` calls `repo.save(...)` on a `UserRepository`, but `save`
        // is declared on `BaseRepository`. Only the classHierarchy walk finds it.
        const fullEdge = inherited(full) as { confidence: number; tier?: string } | undefined;
        const degradedEdge = inherited(degraded) as { confidence: number; tier?: string } | undefined;

        expect(fullEdge?.tier).toBe('receiver');
        expect(fullEdge?.confidence).toBe(0.85);

        // Without classHierarchy the call falls through to the unique-name tier.
        // It lands on the right target here only because `save` happens to be
        // unique in this repo — a second `save` would drop it to ambiguous (0.30)
        // and the default --min-confidence 0.5 would discard it entirely.
        expect(degradedEdge?.tier).toBe('unique');
        expect(degradedEdge?.confidence).toBeLessThan(fullEdge?.confidence ?? 1);
        expect(degraded.stats.receiver).toBeLessThan(full.stats.receiver);
    });

    it('never resolves fewer calls, nor at lower confidence, than the degraded path', async () => {
        const { rawGraph, symbolTable, importMap } = await buildInputs();

        const full = resolveCallsForGraph(rawGraph, symbolTable, importMap);
        const degraded = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);

        expect(full.callEdges.length).toBeGreaterThanOrEqual(degraded.callEdges.length);

        const confOf = (r: typeof full, target: string) =>
            r.callEdges.find((e) => e.target === target)?.confidence ?? 0;
        for (const edge of full.callEdges) {
            expect(confOf(full, edge.target)).toBeGreaterThanOrEqual(confOf(degraded, edge.target));
        }
    });

    it('is equivalent to passing all seven arguments by hand', async () => {
        const { rawGraph, symbolTable, importMap } = await buildInputs();

        const returnTypes = new Map<string, string>();
        for (const f of rawGraph.functions) {
            if (f.returnType) {
                returnTypes.set(f.qualified, f.returnType);
            }
        }
        const classHierarchy = new Map<string, string[]>();
        for (const c of rawGraph.classes) {
            const parents: string[] = [];
            if (c.extends) {
                parents.push(c.extends);
            }
            if (c.implements?.length) {
                parents.push(...c.implements);
            }
            if (parents.length > 0) {
                const existing = classHierarchy.get(c.name);
                classHierarchy.set(c.name, existing ? [...existing, ...parents] : parents);
            }
        }

        const byHand = resolveAllCalls(
            rawGraph.rawCalls,
            rawGraph.diMaps,
            symbolTable,
            importMap,
            returnTypes,
            classHierarchy,
            rawGraph.valueBindings,
        );
        const viaHelper = resolveCallsForGraph(rawGraph, symbolTable, importMap);

        expect(viaHelper.stats).toEqual(byHand.stats);
        expect(viaHelper.callEdges.length).toBe(byHand.callEdges.length);
    });
});
