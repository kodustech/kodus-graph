import { describe, expect, it } from 'bun:test';
import { qualifiedName } from '../../src/shared/qualified-name';

describe('qualifiedName', () => {
    it('should generate file::name for standalone function', () => {
        expect(qualifiedName('src/auth.py', 'authenticate')).toBe('src/auth.py::authenticate');
    });

    it('should generate file::Class.method for class method', () => {
        expect(qualifiedName('src/user.ts', 'validate', 'UserService')).toBe('src/user.ts::UserService.validate');
    });

    it('should handle constructor', () => {
        expect(qualifiedName('src/user.ts', 'constructor', 'UserService')).toBe('src/user.ts::UserService.constructor');
    });

    it('should handle test qualified name', () => {
        expect(qualifiedName('tests/auth.test.ts', 'should authenticate', undefined, true)).toBe(
            'tests/auth.test.ts::test:should authenticate',
        );
    });
});
