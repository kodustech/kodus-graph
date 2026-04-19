// tests/graph/schema-version-check.test.ts
import { describe, expect, it } from 'bun:test';
import { compareSchemaVersions } from '../../src/graph/schema-version-check';

describe('compareSchemaVersions', () => {
    it('"2.0" vs "2.0" -> same', () => {
        expect(compareSchemaVersions('2.0', '2.0')).toBe('same');
    });

    it('"2.1" loaded vs "2.0" current -> newer-minor', () => {
        expect(compareSchemaVersions('2.1', '2.0')).toBe('newer-minor');
    });

    it('"2.0" loaded vs "2.1" current -> older-minor', () => {
        expect(compareSchemaVersions('2.0', '2.1')).toBe('older-minor');
    });

    it('"1.0" loaded vs "2.0" current -> older-major', () => {
        expect(compareSchemaVersions('1.0', '2.0')).toBe('older-major');
    });

    it('"3.0" loaded vs "2.0" current -> newer-major', () => {
        expect(compareSchemaVersions('3.0', '2.0')).toBe('newer-major');
    });

    it('malformed version strings -> older-major (cautious default)', () => {
        expect(compareSchemaVersions('garbage', '2.0')).toBe('older-major');
        expect(compareSchemaVersions('', '2.0')).toBe('older-major');
    });

    it('missing minor treated as minor 0', () => {
        expect(compareSchemaVersions('2', '2.0')).toBe('same');
    });
});
