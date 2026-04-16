import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadMixDeps, resolve } from '../../src/languages/elixir/resolver';

const TMP = join(import.meta.dir, '../fixtures/elixir-basic-tmp');

describe('Elixir basic module resolution', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'lib/my_app'), { recursive: true });
        writeFileSync(join(TMP, 'lib/my_app/user_service.ex'), 'defmodule MyApp.UserService do\nend\n');
        writeFileSync(join(TMP, 'lib/my_app/repo.ex'), 'defmodule MyApp.Repo do\nend\n');
    });

    test('resolves MyApp.UserService to lib/my_app/user_service.ex', () => {
        const result = resolve(join(TMP, 'lib/my_app/repo.ex'), 'MyApp.UserService', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('lib/my_app/user_service.ex');
    });

    test('resolves MyApp.Repo to lib/my_app/repo.ex', () => {
        const result = resolve(join(TMP, 'lib/my_app/user_service.ex'), 'MyApp.Repo', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('lib/my_app/repo.ex');
    });

    test('returns null for non-existent module', () => {
        const result = resolve(join(TMP, 'lib/my_app/repo.ex'), 'MyApp.NonExistent', TMP);
        expect(result).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_UMBRELLA = join(import.meta.dir, '../fixtures/elixir-umbrella-tmp');

describe('Elixir umbrella app resolution', () => {
    test('setup', () => {
        rmSync(TMP_UMBRELLA, { recursive: true, force: true });
        mkdirSync(join(TMP_UMBRELLA, 'apps/my_app/lib/my_app'), { recursive: true });
        mkdirSync(join(TMP_UMBRELLA, 'apps/my_web/lib/my_web'), { recursive: true });
        writeFileSync(join(TMP_UMBRELLA, 'apps/my_app/lib/my_app/user.ex'), 'defmodule MyApp.User do\nend\n');
        writeFileSync(
            join(TMP_UMBRELLA, 'apps/my_web/lib/my_web/controller.ex'),
            'defmodule MyWeb.Controller do\nend\n',
        );
    });

    test('resolves umbrella app module MyApp.User', () => {
        const result = resolve(join(TMP_UMBRELLA, 'apps/my_web/lib/my_web/controller.ex'), 'MyApp.User', TMP_UMBRELLA);
        expect(result).not.toBeNull();
        expect(result).toContain('apps/my_app/lib/my_app/user.ex');
    });

    test('resolves umbrella app module MyWeb.Controller', () => {
        const result = resolve(join(TMP_UMBRELLA, 'apps/my_app/lib/my_app/user.ex'), 'MyWeb.Controller', TMP_UMBRELLA);
        expect(result).not.toBeNull();
        expect(result).toContain('apps/my_web/lib/my_web/controller.ex');
    });

    test('cleanup', () => {
        rmSync(TMP_UMBRELLA, { recursive: true, force: true });
    });
});

const TMP_NESTED = join(import.meta.dir, '../fixtures/elixir-nested-tmp');

describe('Elixir deeply nested module resolution', () => {
    test('setup', () => {
        rmSync(TMP_NESTED, { recursive: true, force: true });
        mkdirSync(join(TMP_NESTED, 'lib/my_app/accounts'), { recursive: true });
        writeFileSync(
            join(TMP_NESTED, 'lib/my_app/accounts/user_service.ex'),
            'defmodule MyApp.Accounts.UserService do\nend\n',
        );
    });

    test('resolves deeply nested module MyApp.Accounts.UserService', () => {
        const result = resolve(join(TMP_NESTED, 'lib/my_app/repo.ex'), 'MyApp.Accounts.UserService', TMP_NESTED);
        expect(result).not.toBeNull();
        expect(result).toContain('lib/my_app/accounts/user_service.ex');
    });

    test('cleanup', () => {
        rmSync(TMP_NESTED, { recursive: true, force: true });
    });
});

const TMP_MIXDEPS = join(import.meta.dir, '../fixtures/elixir-mixdeps-tmp');

describe('Elixir mix.exs deps parsing', () => {
    test('setup', () => {
        rmSync(TMP_MIXDEPS, { recursive: true, force: true });
        mkdirSync(TMP_MIXDEPS, { recursive: true });
        writeFileSync(
            join(TMP_MIXDEPS, 'mix.exs'),
            `defmodule MyApp.MixProject do
  use Mix.Project

  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:ecto, "~> 3.10"},
      {:ecto_sql, "~> 3.10"},
      {:postgrex, ">= 0.0.0"},
      {:phoenix_live_view, "~> 0.20"},
      {:jason, "~> 1.2"},
      {:plug_cowboy, "~> 2.5"}
    ]
  end
end
`,
        );
    });

    test('parses mix.exs deps', () => {
        const deps = loadMixDeps(TMP_MIXDEPS);
        expect(deps.has('phoenix')).toBe(true);
        expect(deps.has('ecto')).toBe(true);
        expect(deps.has('ecto_sql')).toBe(true);
        expect(deps.has('postgrex')).toBe(true);
        expect(deps.has('phoenix_live_view')).toBe(true);
        expect(deps.has('jason')).toBe(true);
        expect(deps.has('plug_cowboy')).toBe(true);
    });

    test('cleanup', () => {
        rmSync(TMP_MIXDEPS, { recursive: true, force: true });
    });
});
