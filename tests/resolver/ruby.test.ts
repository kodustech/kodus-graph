import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/resolver/languages/ruby';

const TMP = join(import.meta.dir, '../fixtures/rb-basic-tmp');

describe('Ruby basic require_relative', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'lib/models'), { recursive: true });
        writeFileSync(join(TMP, 'lib/app.rb'), "require_relative 'models/user'\n");
        writeFileSync(join(TMP, 'lib/models/user.rb'), 'class User\nend\n');
    });

    test('resolves models/user from lib/app.rb', () => {
        const result = resolve(join(TMP, 'lib/app.rb'), 'models/user', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('lib/models/user.rb');
    });

    test('resolves ../app from lib/models/user.rb', () => {
        const result = resolve(join(TMP, 'lib/models/user.rb'), '../app', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('lib/app.rb');
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_GEMPATH = join(import.meta.dir, '../fixtures/rb-gempath-tmp');

describe('Ruby Gemfile path gem', () => {
    test('setup', () => {
        rmSync(TMP_GEMPATH, { recursive: true, force: true });
        mkdirSync(join(TMP_GEMPATH, 'libs/mylib/lib/mylib'), { recursive: true });
        writeFileSync(
            join(TMP_GEMPATH, 'Gemfile'),
            ["source 'https://rubygems.org'", '', "gem 'mylib', path: './libs/mylib'", ''].join('\n'),
        );
        writeFileSync(join(TMP_GEMPATH, 'libs/mylib/lib/mylib.rb'), "require 'mylib/helper'\n\nmodule Mylib\nend\n");
        writeFileSync(
            join(TMP_GEMPATH, 'libs/mylib/lib/mylib/helper.rb'),
            'module Mylib\n  module Helper\n  end\nend\n',
        );
        writeFileSync(join(TMP_GEMPATH, 'app.rb'), "require 'mylib'\nrequire 'mylib/helper'\n");
    });

    test('resolves require mylib from app.rb via Gemfile path gem', () => {
        const result = resolve(join(TMP_GEMPATH, 'app.rb'), 'mylib', TMP_GEMPATH);
        expect(result).not.toBeNull();
        expect(result).toContain('libs/mylib/lib/mylib.rb');
    });

    test('resolves require mylib/helper from app.rb via Gemfile path gem', () => {
        const result = resolve(join(TMP_GEMPATH, 'app.rb'), 'mylib/helper', TMP_GEMPATH);
        expect(result).not.toBeNull();
        expect(result).toContain('libs/mylib/lib/mylib/helper.rb');
    });

    test('cleanup', () => {
        rmSync(TMP_GEMPATH, { recursive: true, force: true });
    });
});
