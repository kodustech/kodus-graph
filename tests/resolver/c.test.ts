import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/languages/c/resolver';

const TMP = join(import.meta.dir, '../fixtures/c-resolver-tmp');

describe('C/C++ import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'src/models'), { recursive: true });
        mkdirSync(join(TMP, 'include'), { recursive: true });
        writeFileSync(join(TMP, 'src/main.c'), '#include "utils.h"\n');
        writeFileSync(join(TMP, 'src/utils.h'), '// utils header\n');
        writeFileSync(join(TMP, 'src/utils.c'), '// utils impl\n');
        writeFileSync(join(TMP, 'src/models/user.h'), '// user model\n');
        writeFileSync(join(TMP, 'include/config.h'), '// config header\n');
    });

    test('resolves local include relative to source file', () => {
        const result = resolve(join(TMP, 'src/main.c'), 'utils.h', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('utils.h');
    });

    test('resolves relative path include', () => {
        const result = resolve(join(TMP, 'src/main.c'), 'models/user.h', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('user.h');
    });

    test('resolves from include/ directory', () => {
        const result = resolve(join(TMP, 'src/main.c'), 'config.h', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('config.h');
    });

    test('resolves from project root', () => {
        // Create a file at project root level
        writeFileSync(join(TMP, 'global.h'), '// global header\n');
        const result = resolve(join(TMP, 'src/main.c'), 'global.h', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('global.h');
    });

    test('returns null for non-existent local include', () => {
        const result = resolve(join(TMP, 'src/main.c'), 'nonexistent.h', TMP);
        expect(result).toBeNull();
    });

    test('returns null for system headers that do not exist locally', () => {
        // System headers like stdio.h won't exist in the project
        const result = resolve(join(TMP, 'src/main.c'), 'stdio.h', TMP);
        expect(result).toBeNull();
    });

    test('probes extensions when extension is not provided', () => {
        // utils exists as utils.h and utils.c
        const result = resolve(join(TMP, 'src/main.c'), 'utils', TMP);
        expect(result).not.toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_CPP = join(import.meta.dir, '../fixtures/cpp-resolver-tmp');

describe('C++ import resolver', () => {
    test('setup', () => {
        rmSync(TMP_CPP, { recursive: true, force: true });
        mkdirSync(join(TMP_CPP, 'src'), { recursive: true });
        mkdirSync(join(TMP_CPP, 'include/models'), { recursive: true });
        writeFileSync(join(TMP_CPP, 'src/main.cpp'), '#include "app.hpp"\n');
        writeFileSync(join(TMP_CPP, 'src/app.hpp'), '// app header\n');
        writeFileSync(join(TMP_CPP, 'src/app.cpp'), '// app impl\n');
        writeFileSync(join(TMP_CPP, 'include/models/user.hpp'), '// user model\n');
    });

    test('resolves .hpp include relative to source', () => {
        const result = resolve(join(TMP_CPP, 'src/main.cpp'), 'app.hpp', TMP_CPP);
        expect(result).not.toBeNull();
        expect(result).toContain('app.hpp');
    });

    test('resolves from include/ directory', () => {
        const result = resolve(join(TMP_CPP, 'src/main.cpp'), 'models/user.hpp', TMP_CPP);
        expect(result).not.toBeNull();
        expect(result).toContain('user.hpp');
    });

    test('returns null for C++ standard library headers', () => {
        const result = resolve(join(TMP_CPP, 'src/main.cpp'), 'string', TMP_CPP);
        expect(result).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP_CPP, { recursive: true, force: true });
    });
});
