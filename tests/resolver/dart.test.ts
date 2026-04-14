import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/resolver/languages/dart';

const TMP = join(import.meta.dir, '../fixtures/dart-resolver-tmp');

describe('Dart import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'lib/models'), { recursive: true });
        mkdirSync(join(TMP, 'lib/src'), { recursive: true });
        writeFileSync(join(TMP, 'pubspec.yaml'), 'name: my_app\ndependencies:\n  http: ^0.13.0\n  provider: ^6.0.0\n');
        writeFileSync(join(TMP, 'lib/models/user.dart'), 'class User {}\n');
        writeFileSync(join(TMP, 'lib/src/service.dart'), 'class Service {}\n');
    });

    test('returns null for dart:async (SDK import)', () => {
        expect(resolve(join(TMP, 'lib/main.dart'), 'dart:async', TMP)).toBeNull();
    });

    test('returns null for dart:io (SDK import)', () => {
        expect(resolve(join(TMP, 'lib/main.dart'), 'dart:io', TMP)).toBeNull();
    });

    test('returns null for dart:convert (SDK import)', () => {
        expect(resolve(join(TMP, 'lib/main.dart'), 'dart:convert', TMP)).toBeNull();
    });

    test('returns null for package:flutter/material.dart (framework)', () => {
        expect(resolve(join(TMP, 'lib/main.dart'), 'package:flutter/material.dart', TMP)).toBeNull();
    });

    test('returns null for package:flutter_test/flutter_test.dart (framework)', () => {
        expect(resolve(join(TMP, 'lib/main.dart'), 'package:flutter_test/flutter_test.dart', TMP)).toBeNull();
    });

    test('resolves own package import via pubspec.yaml name', () => {
        const result = resolve(join(TMP, 'lib/main.dart'), 'package:my_app/models/user.dart', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('user.dart');
    });

    test('resolves own package src import', () => {
        const result = resolve(join(TMP, 'lib/main.dart'), 'package:my_app/src/service.dart', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('service.dart');
    });

    test('returns null for external package import (http)', () => {
        expect(resolve(join(TMP, 'lib/main.dart'), 'package:http/http.dart', TMP)).toBeNull();
    });

    test('resolves relative import', () => {
        const result = resolve(join(TMP, 'lib/models/user.dart'), '../src/service.dart', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('service.dart');
    });

    test('returns null for non-existent relative import', () => {
        expect(resolve(join(TMP, 'lib/main.dart'), './nonexistent.dart', TMP)).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});
