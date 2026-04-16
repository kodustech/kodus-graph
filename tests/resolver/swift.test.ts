import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/languages/swift/resolver';

const TMP = join(import.meta.dir, '../fixtures/swift-resolver-tmp');

describe('Swift import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'Sources/MyModule'), { recursive: true });
        mkdirSync(join(TMP, 'Sources/Networking'), { recursive: true });
        writeFileSync(join(TMP, 'Sources/MyModule/MyModule.swift'), 'public struct MyModule {}\n');
        writeFileSync(join(TMP, 'Sources/Networking/Client.swift'), 'public class Client {}\n');
    });

    test('resolves local module in Sources directory', () => {
        const result = resolve('', 'MyModule', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('MyModule.swift');
    });

    test('resolves local module with different file name in Sources', () => {
        const result = resolve('', 'Networking', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('.swift');
    });

    test('returns null for Foundation framework', () => {
        expect(resolve('', 'Foundation', TMP)).toBeNull();
    });

    test('returns null for UIKit framework', () => {
        expect(resolve('', 'UIKit', TMP)).toBeNull();
    });

    test('returns null for SwiftUI framework', () => {
        expect(resolve('', 'SwiftUI', TMP)).toBeNull();
    });

    test('returns null for Combine framework', () => {
        expect(resolve('', 'Combine', TMP)).toBeNull();
    });

    test('returns null for CoreData framework', () => {
        expect(resolve('', 'CoreData', TMP)).toBeNull();
    });

    test('returns null for XCTest framework', () => {
        expect(resolve('', 'XCTest', TMP)).toBeNull();
    });

    test('returns null for MapKit framework', () => {
        expect(resolve('', 'MapKit', TMP)).toBeNull();
    });

    test('returns null for AVFoundation framework', () => {
        expect(resolve('', 'AVFoundation', TMP)).toBeNull();
    });

    test('returns null for module not present on disk', () => {
        expect(resolve('', 'NonExistentModule', TMP)).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_SPM = join(import.meta.dir, '../fixtures/swift-spm-tmp');

describe('Swift SPM multi-target resolution', () => {
    test('setup', () => {
        rmSync(TMP_SPM, { recursive: true, force: true });
        mkdirSync(join(TMP_SPM, 'Sources/App'), { recursive: true });
        mkdirSync(join(TMP_SPM, 'Sources/Models'), { recursive: true });
        writeFileSync(join(TMP_SPM, 'Sources/App/App.swift'), 'import Models\n@main struct App {}\n');
        writeFileSync(join(TMP_SPM, 'Sources/Models/User.swift'), 'public struct User {}\n');
    });

    test('resolves Models target in SPM multi-target project', () => {
        const result = resolve('', 'Models', TMP_SPM);
        expect(result).not.toBeNull();
        expect(result).toContain('User.swift');
    });

    test('resolves App target in SPM multi-target project', () => {
        const result = resolve('', 'App', TMP_SPM);
        expect(result).not.toBeNull();
        expect(result).toContain('App.swift');
    });

    test('cleanup', () => {
        rmSync(TMP_SPM, { recursive: true, force: true });
    });
});
