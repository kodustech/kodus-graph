import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { GraphEdge, ParseOutput, RawGraph } from '../../src/graph/types';
import { resolveCallsForGraph } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';
import { runCli } from '../helpers/run-cli';

/**
 * A call whose receiver type is known but not declared in the repo is external.
 *
 * The receiver tier used to fall through when `Type.method` wasn't in the symbol
 * table, and the name cascade then pinned JDK calls on same-named repo methods:
 * `s.trim()` on a `String` became a CALLS edge to `StringUtils.trim`. On Apache
 * Dubbo 35k calls took that path — most of its 0.30 edges and a slice of the
 * 0.50/0.60 ones that pass the default filter.
 */

const tmpDirs: string[] = [];

afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
        rmSync(d, { recursive: true, force: true });
    }
});

function repo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'kodus-graph-external-receiver-'));
    tmpDirs.push(dir);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
    return dir;
}

function callsFrom(dir: string, sourceFile: string): GraphEdge[] {
    const out = join(dir, 'graph.json');
    runCli(['parse', '--all', '--repo-dir', dir, '--out', out]);
    const g = JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput;
    return g.edges.filter((e) => e.kind === 'CALLS' && e.source_qualified.startsWith(`${sourceFile}::`));
}

const targets = (edges: GraphEdge[]) => edges.map((e) => e.target_qualified.split('::')[1]).sort();

describe('receiver tier: known receiver types this repo does not declare', () => {
    const javaRepo = {
        'src/StringUtils.java': `package app;

public class StringUtils {
    public static String trim(String s) {
        return s == null ? null : s.strip();
    }
}
`,
        'src/Color.java': `package app;

public enum Color {
    RED;

    public String label() {
        return name().toLowerCase();
    }
}
`,
        'src/Caller.java': `package app;

import java.net.URLDecoder;

public class Caller {
    public String jdkString(String s) {
        return s.trim();
    }

    public String jdkStatic(String s) throws Exception {
        return URLDecoder.decode(s, "UTF-8");
    }

    public String repoStatic(String s) {
        return StringUtils.trim(s);
    }

    public String repoEnum(Color c) {
        return c.label();
    }
}
`,
    };

    it('drops calls on JDK types instead of pinning them on same-named repo methods', () => {
        const dir = repo(javaRepo);
        const edges = callsFrom(dir, 'src/Caller.java');
        const bySource = (m: string) => targets(edges.filter((e) => e.source_qualified.endsWith(`Caller.${m}`)));
        expect(bySource('jdkString')).toEqual([]);
        expect(bySource('jdkStatic')).toEqual([]);
    });

    it('keeps calls on repo classes and repo enums', () => {
        const dir = repo(javaRepo);
        const edges = callsFrom(dir, 'src/Caller.java');
        const bySource = (m: string) => targets(edges.filter((e) => e.source_qualified.endsWith(`Caller.${m}`)));
        expect(bySource('repoStatic')).toEqual(['StringUtils.trim']);
        // Java enum methods are qualified without the enum name (`Color.java::label`).
        expect(bySource('repoEnum')).toEqual(['label']);
    });

    it('keeps a call whose receiver type came from a generic return type (TS factory)', () => {
        // `createRegistry<T>()` returns `Registry<T>`; stripGenerics turns that into
        // `T`, which must not be read as "an external type".
        const dir = repo({
            'src/registry.ts': `export interface Registry<T> {
    clearForTests(): void;
    get(key: string): T | undefined;
}

export function createRegistry<T>(): Registry<T> {
    const map = new Map<string, T>();
    return {
        clearForTests() {
            map.clear();
        },
        get(key: string) {
            return map.get(key);
        },
    };
}
`,
            'src/user.ts': `import { createRegistry } from './registry';

const REGISTRY = createRegistry<string>();

export function reset(): void {
    REGISTRY.clearForTests();
}
`,
        });
        const edges = callsFrom(dir, 'src/user.ts');
        expect(targets(edges)).toContain('clearForTests');
    });
});

describe('receiver tier: in-repo types it must not read as external', () => {
    const tsRepo = {
        'src/impl.ts': `export class Impl {
    handle(): void {}
}

export class Repo {
    save(): void {}
}
`,
        'src/use.ts': `import { Impl, Repo } from './impl';

type Handler = Impl;

namespace Api {
    export function load(): void {}
}

export function viaAlias(h: Handler): void {
    h.handle();
}

export function viaTypeVar<TItem extends Repo>(item: TItem): void {
    item.save();
}

export function viaNamespace(): void {
    Api.load();
}
`,
    };

    const calleesOf = (edges: GraphEdge[], fn: string) =>
        targets(edges.filter((e) => e.source_qualified === `src/use.ts::${fn}`));

    it('keeps a call on a same-file type alias', () => {
        expect(calleesOf(callsFrom(repo(tsRepo), 'src/use.ts'), 'viaAlias')).toEqual(['Impl.handle']);
    });

    it('keeps a call on a same-file namespace', () => {
        expect(calleesOf(callsFrom(repo(tsRepo), 'src/use.ts'), 'viaNamespace')).toEqual(['load']);
    });

    it('keeps a call on a T-prefixed type variable (TItem)', () => {
        expect(calleesOf(callsFrom(repo(tsRepo), 'src/use.ts'), 'viaTypeVar')).toEqual(['Repo.save']);
    });
});

describe('receiver tier: slices that do not see every declaration', () => {
    // `analyze` and `diff` resolve only the files they re-parse. `Child` lives in
    // a file outside the slice, so its absence proves nothing about the repo.
    const rawGraph = (): RawGraph => ({
        functions: [],
        classes: [],
        interfaces: [],
        enums: [],
        tests: [],
        imports: [],
        reExports: [],
        rawCalls: [{ source: 'src/Caller.java', callName: 'run', line: 5, receiverType: 'Child' }],
        diMaps: new Map(),
        valueBindings: new Map(),
    });
    const symbols = () => {
        const table = createSymbolTable();
        table.add('src/Base.java', 'run', 'src/Base.java::Base.run');
        return table;
    };

    it('does not drop the call when the declarations are a slice', () => {
        const { callEdges, stats } = resolveCallsForGraph(rawGraph(), symbols(), createImportMap());
        expect(stats.externalReceiver).toBe(0);
        expect(callEdges.map((e) => e.target)).toEqual(['src/Base.java::Base.run']);
    });

    it('drops it when the caller says the declarations cover the repo', () => {
        const { callEdges, stats } = resolveCallsForGraph(rawGraph(), symbols(), createImportMap(), {
            repoComplete: true,
        });
        expect(stats.externalReceiver).toBe(1);
        expect(callEdges).toEqual([]);
    });
});
