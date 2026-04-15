import { describe, expect, test } from 'bun:test';
import { parseAsync } from '@ast-grep/napi';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawGraph } from '../../src/graph/types';
import { extractFromFile } from '../../src/parser/extractor';
import '../../src/parser/languages'; // trigger registration

const FIXTURES = join(import.meta.dir, '../fixtures');

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

// ---------------------------------------------------------------------------
// Elixir
// ---------------------------------------------------------------------------

describe('extractElixir – modules', () => {
    test('extracts defmodule MyApp.UserService as class', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'MyApp.UserService');
        expect(userService).toBeDefined();
        expect(userService!.ast_kind).toBe('call');
        expect(userService!.is_exported).toBe(true);
    });

    test('extracts MyApp.UserService extends GenServer (from use)', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'MyApp.UserService');
        expect(userService).toBeDefined();
        expect(userService!.extends).toBe('GenServer');
    });

    test('extracts @behaviour as implements', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const userService = graph.classes.find((c) => c.name === 'MyApp.UserService');
        expect(userService).toBeDefined();
        expect(userService!.implements).toContain('MyApp.Repository');
    });

    test('extracts MyApp.Repository as both class and interface', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const repoClass = graph.classes.find((c) => c.name === 'MyApp.Repository');
        expect(repoClass).toBeDefined();

        const repoInterface = graph.interfaces.find((i) => i.name === 'MyApp.Repository');
        expect(repoInterface).toBeDefined();
        expect(repoInterface!.methods).toContain('get_user');
        expect(repoInterface!.methods).toContain('save_user');
    });
});

describe('extractElixir – functions', () => {
    test('extracts def as public method with is_exported true', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const startLink = graph.functions.find((f) => f.name === 'start_link');
        expect(startLink).toBeDefined();
        expect(startLink!.is_exported).toBe(true);
        expect(startLink!.kind).toBe('Method');
        expect(startLink!.className).toBe('MyApp.UserService');
    });

    test('extracts defp as private method with is_exported false', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const validate = graph.functions.find((f) => f.name === 'validate');
        expect(validate).toBeDefined();
        // The engine normalizes false to undefined, so check it's falsy
        expect(validate!.is_exported).toBeFalsy();
        expect(validate!.kind).toBe('Method');
    });

    test('extracts all functions from UserService', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const userServiceFns = graph.functions.filter((f) => f.className === 'MyApp.UserService');
        const fnNames = userServiceFns.map((f) => f.name).sort();
        expect(fnNames).toContain('start_link');
        expect(fnNames).toContain('get_user');
        expect(fnNames).toContain('validate');
        expect(fnNames).toContain('init');
        expect(fnNames).toContain('handle_call');
    });

    test('is_async is always false for Elixir', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        for (const f of graph.functions) {
            expect(f.is_async).toBeFalsy();
        }
    });

    test('extracts params', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const startLink = graph.functions.find((f) => f.name === 'start_link');
        expect(startLink).toBeDefined();
        expect(startLink!.params).toContain('opts');

        const handleCall = graph.functions.find((f) => f.name === 'handle_call');
        expect(handleCall).toBeDefined();
        expect(handleCall!.params).toContain('_from');
        expect(handleCall!.params).toContain('state');
    });
});

describe('extractElixir – imports', () => {
    test('extracts use/alias/import as imports', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        const modules = graph.imports.map((i) => i.module);
        expect(modules).toContain('GenServer');
        expect(modules).toContain('MyApp.Repo');
        expect(modules).toContain('Ecto.Query');
    });

    test('all imports have lang elixir', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        for (const imp of graph.imports) {
            expect(imp.lang).toBe('elixir');
        }
    });
});

describe('extractElixir – call extraction', () => {
    test('extracts function calls from body', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, fp, 'elixir', new Set(), graph);

        // Extract calls
        const { extractCallsFromFile } = await import('../../src/parser/extractor');
        const calls: RawGraph['rawCalls'] = [];
        extractCallsFromFile(root, fp, 'elixir', calls);

        const callNames = calls.map((c) => c.callName);
        // GenServer.start_link → callName = start_link
        expect(callNames).toContain('start_link');
        // get_user(id) → callName = get_user
        expect(callNames).toContain('get_user');
        // Note: Repo.get is filtered by NOISE (get is a JS/TS noise word)
    });

    test('dot calls have resolveInClass for module calls', async () => {
        const fp = join(FIXTURES, 'elixir/sample.ex');
        const code = readFileSync(fp, 'utf-8');
        const root = await parseAsync('elixir', code);

        const { extractCallsFromFile } = await import('../../src/parser/extractor');
        const calls: RawGraph['rawCalls'] = [];
        extractCallsFromFile(root, fp, 'elixir', calls);

        // GenServer.start_link should resolve in GenServer
        const gsCall = calls.find((c) => c.callName === 'start_link' && c.resolveInClass === 'GenServer');
        expect(gsCall).toBeDefined();
    });
});

describe('extractElixir – test detection', () => {
    test('detects test functions', async () => {
        const code = `
defmodule MyApp.UserServiceTest do
  use ExUnit.Case

  test "get_user returns user" do
    assert true
  end

  test "validate rejects empty name" do
    assert true
  end

  def helper_function do
    :ok
  end
end
`;
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, 'test/my_app/user_service_test.exs', 'elixir', new Set(), graph);

        // ExUnit test macros produce functions with names like 'test "description"'
        const testFns = graph.functions.filter((f) => f.name.startsWith('test '));
        expect(testFns.length).toBeGreaterThanOrEqual(2);
        expect(testFns.every((f) => f.name.startsWith('test '))).toBe(true);

        // Test functions should be in graph.tests (isTest flag)
        expect(graph.tests.length).toBeGreaterThanOrEqual(2);

        // helper_function should NOT be a test
        const helper = graph.functions.find((f) => f.name === 'helper_function');
        expect(helper).toBeDefined();
    });
});

describe('new fields – Elixir', () => {
    test('def has is_exported=true', async () => {
        const code = [
            'defmodule Svc do',
            '  def public_fn(x), do: x',
            'end',
        ].join('\n');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, 'svc.ex', 'elixir', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'public_fn');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBe(true);
    });

    test('defp has is_exported=false', async () => {
        const code = [
            'defmodule Svc do',
            '  defp private_fn(x), do: x',
            'end',
        ].join('\n');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, 'svc.ex', 'elixir', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'private_fn');
        expect(fn).toBeDefined();
        expect(fn!.is_exported).toBeFalsy();
    });

    test('defmodule class is exported', async () => {
        const code = 'defmodule MyApp.Svc do\nend';
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, 'svc.ex', 'elixir', new Set(), graph);

        const cls = graph.classes.find((c) => c.name === 'MyApp.Svc');
        expect(cls).toBeDefined();
        expect(cls!.is_exported).toBe(true);
    });

    test('Elixir function has is_async=false (uses processes, not async)', async () => {
        const code = [
            'defmodule Svc do',
            '  def run(x), do: x',
            'end',
        ].join('\n');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, 'svc.ex', 'elixir', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'run');
        expect(fn).toBeDefined();
        expect(fn!.is_async).toBeFalsy();
    });

    test('Elixir function has no decorators (module attributes are not decorators)', async () => {
        const code = [
            'defmodule Svc do',
            '  @doc "Runs something"',
            '  def run(x), do: x',
            'end',
        ].join('\n');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, 'svc.ex', 'elixir', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'run');
        expect(fn).toBeDefined();
        expect(fn!.decorators ?? []).toEqual([]);
    });

    test('Elixir function has empty throws (no throws concept)', async () => {
        const code = [
            'defmodule Svc do',
            '  def fail do',
            '    raise ArgumentError, "x"',
            '  end',
            'end',
        ].join('\n');
        const root = await parseAsync('elixir', code);
        const graph = emptyGraph();
        extractFromFile(root, 'svc.ex', 'elixir', new Set(), graph);

        const fn = graph.functions.find((f) => f.name === 'fail');
        expect(fn).toBeDefined();
        expect(fn!.throws ?? []).toEqual([]);
    });
});
