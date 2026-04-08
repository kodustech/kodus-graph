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
