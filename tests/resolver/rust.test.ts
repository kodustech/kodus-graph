import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/resolver/languages/rust';

const TMP = join(import.meta.dir, '../fixtures/rust-resolver-tmp');

describe('Rust import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'src/models'), { recursive: true });
        mkdirSync(join(TMP, 'src/utils'), { recursive: true });
        writeFileSync(join(TMP, 'src/utils.rs'), 'pub fn helper() {}\n');
        writeFileSync(join(TMP, 'src/utils/format.rs'), 'pub fn fmt_val() {}\n');
        writeFileSync(join(TMP, 'src/utils/helper.rs'), 'pub fn help() {}\n');
        writeFileSync(join(TMP, 'src/models/mod.rs'), 'pub struct User;\n');
        writeFileSync(join(TMP, 'src/lib.rs'), 'mod utils;\nmod models;\n');
    });

    test('resolves crate:: to a .rs file', () => {
        const result = resolve(join(TMP, 'src/main.rs'), 'crate::utils', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('utils.rs');
    });

    test('resolves crate:: to a submodule file', () => {
        const result = resolve(join(TMP, 'src/main.rs'), 'crate::utils::format', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('format.rs');
    });

    test('resolves crate:: to mod.rs', () => {
        const result = resolve(join(TMP, 'src/main.rs'), 'crate::models', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('mod.rs');
    });

    test('resolves self:: relative to current file directory', () => {
        // from src/utils/format.rs, self::format probes src/utils/format.rs (sibling)
        // use a file inside the utils dir so dirname is src/utils/
        const result = resolve(join(TMP, 'src/utils/format.rs'), 'self::format', TMP);
        // dirname(fromAbsFile) = src/utils, probe src/utils/format.rs
        expect(result).not.toBeNull();
        expect(result).toContain('format.rs');
    });

    test('resolves super:: from regular file (sibling in parent module)', () => {
        // from src/utils/format.rs, super:: = crate::utils, probes src/utils/
        const result = resolve(join(TMP, 'src/utils/format.rs'), 'super::helper', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('helper.rs');
    });

    test('resolves super:: from mod.rs (goes up two levels)', () => {
        // from src/models/mod.rs, super:: = crate, probes src/
        const result = resolve(join(TMP, 'src/models/mod.rs'), 'super::utils', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('utils.rs');
    });

    test('returns null for std:: imports', () => {
        expect(resolve(join(TMP, 'src/main.rs'), 'std::fmt', TMP)).toBeNull();
        expect(resolve(join(TMP, 'src/main.rs'), 'std::collections::HashMap', TMP)).toBeNull();
    });

    test('returns null for external crate without prefix', () => {
        expect(resolve(join(TMP, 'src/main.rs'), 'serde::Serialize', TMP)).toBeNull();
        expect(resolve(join(TMP, 'src/main.rs'), 'tokio::runtime', TMP)).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_WORKSPACE = join(import.meta.dir, '../fixtures/rust-workspace-tmp');

describe('Rust workspace path deps', () => {
    test('setup', () => {
        rmSync(TMP_WORKSPACE, { recursive: true, force: true });
        mkdirSync(join(TMP_WORKSPACE, 'crates/app/src'), { recursive: true });
        mkdirSync(join(TMP_WORKSPACE, 'crates/shared/src'), { recursive: true });
        writeFileSync(
            join(TMP_WORKSPACE, 'Cargo.toml'),
            '[workspace]\nmembers = ["crates/*"]\n',
        );
        writeFileSync(
            join(TMP_WORKSPACE, 'crates/app/Cargo.toml'),
            '[package]\nname = "app"\n\n[dependencies]\nshared = { path = "../shared" }\n',
        );
        writeFileSync(
            join(TMP_WORKSPACE, 'crates/shared/Cargo.toml'),
            '[package]\nname = "shared"\n',
        );
        writeFileSync(join(TMP_WORKSPACE, 'crates/app/src/main.rs'), 'use shared::helper::format;\n');
        writeFileSync(join(TMP_WORKSPACE, 'crates/shared/src/lib.rs'), 'pub mod helper;\n');
        writeFileSync(join(TMP_WORKSPACE, 'crates/shared/src/helper.rs'), 'pub fn format() {}\n');
    });

    test('resolves shared::helper::format across workspace path dep', () => {
        const result = resolve(
            join(TMP_WORKSPACE, 'crates/app/src/main.rs'),
            'shared::helper::format',
            TMP_WORKSPACE,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('helper.rs');
    });

    test('cleanup', () => {
        rmSync(TMP_WORKSPACE, { recursive: true, force: true });
    });
});

const TMP_MOD_PATTERNS = join(import.meta.dir, '../fixtures/rust-mod-patterns-tmp');

describe('Rust mod patterns (file vs dir)', () => {
    test('setup', () => {
        rmSync(TMP_MOD_PATTERNS, { recursive: true, force: true });
        mkdirSync(join(TMP_MOD_PATTERNS, 'src/beta'), { recursive: true });
        writeFileSync(
            join(TMP_MOD_PATTERNS, 'Cargo.toml'),
            '[package]\nname = "mod-patterns"\nedition = "2021"\n',
        );
        writeFileSync(join(TMP_MOD_PATTERNS, 'src/lib.rs'), 'mod alpha;\nmod beta;\n');
        writeFileSync(join(TMP_MOD_PATTERNS, 'src/alpha.rs'), 'pub fn hello() {}\n');
        writeFileSync(join(TMP_MOD_PATTERNS, 'src/beta/mod.rs'), 'pub fn world() {}\n');
    });

    test('resolves crate::alpha to alpha.rs', () => {
        const result = resolve(
            join(TMP_MOD_PATTERNS, 'src/lib.rs'),
            'crate::alpha',
            TMP_MOD_PATTERNS,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('alpha.rs');
    });

    test('resolves crate::beta to beta/mod.rs', () => {
        const result = resolve(
            join(TMP_MOD_PATTERNS, 'src/lib.rs'),
            'crate::beta',
            TMP_MOD_PATTERNS,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('mod.rs');
    });

    test('cleanup', () => {
        rmSync(TMP_MOD_PATTERNS, { recursive: true, force: true });
    });
});
