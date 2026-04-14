/**
 * External package detector.
 * Reads dependency manifests (package.json, requirements.txt, go.mod, etc.)
 * to determine if an import target is an external (third-party) package.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { cachedExists } from './fs-cache';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface LangDeps {
    packages: Set<string>;
    /** Extra metadata per language (e.g. Go module path) */
    meta?: Record<string, string>;
}

const depsCache = new Map<string, Map<string, LangDeps>>();

export function clearExternalCache(): void {
    depsCache.clear();
}

// ---------------------------------------------------------------------------
// Built-in / stdlib lists
// ---------------------------------------------------------------------------

const NODE_BUILTINS = new Set([
    'fs',
    'path',
    'os',
    'http',
    'https',
    'http2',
    'net',
    'stream',
    'buffer',
    'url',
    'util',
    'crypto',
    'events',
    'child_process',
    'cluster',
    'dns',
    'readline',
    'repl',
    'tls',
    'vm',
    'zlib',
    'assert',
    'async_hooks',
    'console',
    'constants',
    'dgram',
    'diagnostics_channel',
    'domain',
    'inspector',
    'module',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'string_decoder',
    'timers',
    'tty',
    'v8',
    'wasi',
    'worker_threads',
]);

const PYTHON_STDLIB = new Set([
    'os',
    'sys',
    'json',
    'typing',
    'collections',
    'datetime',
    're',
    'math',
    'pathlib',
    'functools',
    'itertools',
    'abc',
    'dataclasses',
    'enum',
    'logging',
    'unittest',
    'io',
    'copy',
    'hashlib',
    'hmac',
    'secrets',
    'socket',
    'http',
    'urllib',
    'email',
    'html',
    'xml',
    'sqlite3',
    'csv',
    'configparser',
    'argparse',
    'subprocess',
    'threading',
    'multiprocessing',
    'asyncio',
    'signal',
    'shutil',
    'tempfile',
    'glob',
    'fnmatch',
    'struct',
    'codecs',
    'pprint',
    'textwrap',
    'difflib',
    'traceback',
    'warnings',
    'contextlib',
    'weakref',
    'types',
    'inspect',
    'dis',
    'importlib',
    'pkgutil',
    'pdb',
    'cProfile',
    'time',
    'calendar',
    'random',
    'statistics',
    'fractions',
    'decimal',
    'operator',
    'string',
    'base64',
    'binascii',
    'zlib',
    'gzip',
    'bz2',
    'lzma',
    'zipfile',
    'tarfile',
    // additional commonly used stdlib modules
    'builtins',
    'array',
    'bisect',
    'heapq',
    'queue',
    'sched',
    'selectors',
    'mmap',
    'ctypes',
    'concurrent',
    'test',
    'profile',
    'cmath',
    'numbers',
    'locale',
    'gettext',
    'unicodedata',
    'stringprep',
    'rlcompleter',
    'code',
    'codeop',
    'compileall',
    'py_compile',
    'zipimport',
    'winreg',
    'winsound',
    'msvcrt',
    'posixpath',
    'ntpath',
    'genericpath',
    'posix',
    'nt',
    'token',
    'tokenize',
    'keyword',
    'linecache',
    'pickle',
    'shelve',
    'marshal',
    'dbm',
    'platform',
    'errno',
    'faulthandler',
    'atexit',
    'site',
    'sysconfig',
    'zipapp',
    'venv',
    'ensurepip',
    'distutils',
    'setuptools',
    '_thread',
    '__future__',
    'colorsys',
    'fileinput',
    'filecmp',
    'stat',
    'grp',
    'pwd',
    'resource',
    'termios',
    'fcntl',
    'pty',
    'pipes',
    'mailbox',
    'mailcap',
    'mimetypes',
    'imaplib',
    'poplib',
    'smtplib',
    'ftplib',
    'telnetlib',
    'xmlrpc',
    'ipaddress',
    'ssl',
    'cgi',
    'cgitb',
    'wsgiref',
    'webbrowser',
    'uuid',
    'getpass',
    'curses',
    'turtle',
    'cmd',
    'shlex',
    'tkinter',
    'idlelib',
    'doctest',
    'pydoc',
    'ast',
    'symtable',
    'tabnanny',
]);

const RUBY_STDLIB = new Set([
    'json',
    'net/http',
    'uri',
    'fileutils',
    'set',
    'csv',
    'yaml',
    'openssl',
    'pathname',
    'tempfile',
    'socket',
    'open-uri',
    'erb',
    'cgi',
    'digest',
    'base64',
    'securerandom',
    'optparse',
    'logger',
    'stringio',
    'strscan',
    'date',
    'time',
    'bigdecimal',
    'fiddle',
    'readline',
    'io/console',
    'benchmark',
    'minitest',
    'pp',
    'irb',
    'rdoc',
    'psych',
    'zlib',
    'webrick',
    'rexml',
    'rss',
    'drb',
    'mutex_m',
    'observer',
    'singleton',
    'forwardable',
    'delegate',
    'ostruct',
    'open3',
    'shellwords',
    'abbrev',
    'english',
    'find',
    'resolv',
    'ipaddr',
    'un',
    'mkmf',
]);

const JAVA_STDLIB_PREFIXES = ['java.', 'javax.', 'jakarta.', 'sun.', 'com.sun.', 'jdk.'];

const KOTLIN_STDLIB_PREFIXES = ['kotlin.', 'kotlinx.', ...JAVA_STDLIB_PREFIXES];

const SCALA_STDLIB_PREFIXES = ['scala.', 'akka.', 'play.', ...JAVA_STDLIB_PREFIXES];

const RUST_STDLIB_CRATES = new Set(['std', 'core', 'alloc']);

/** Elixir/Erlang stdlib modules (top-level segment or full name). */
const ELIXIR_STDLIB_MODULES = new Set([
    // Elixir stdlib
    'GenServer',
    'Agent',
    'Task',
    'Supervisor',
    'DynamicSupervisor',
    'Logger',
    'Enum',
    'Stream',
    'Map',
    'Keyword',
    'List',
    'Tuple',
    'String',
    'Regex',
    'File',
    'IO',
    'Path',
    'Port',
    'Process',
    'Application',
    'Code',
    'Kernel',
    'Module',
    'Protocol',
    'Access',
    'Base',
    'Bitwise',
    'Calendar',
    'Date',
    'DateTime',
    'NaiveDateTime',
    'Time',
    'Exception',
    'Float',
    'Function',
    'Integer',
    'MapSet',
    'Node',
    'OptionParser',
    'Range',
    'Record',
    'Registry',
    'System',
    'URI',
    'Version',
    'Inspect',
    'Collectable',
    'Enumerable',
    'GenEvent',
    'HashDict',
    'HashSet',
    'Set',
    'Dict',
    'Macro',
    'Config',
    'Mix',
    'ExUnit',
    'EEx',
    'IEx',
    // Common Elixir standard library prefixes
    'Supervisor.Spec',
    'Task.Supervisor',
    // Erlang modules (commonly used from Elixir via :module syntax)
    ':erlang',
    ':ets',
    ':dets',
    ':mnesia',
    ':gen_server',
    ':gen_statem',
    ':gen_event',
    ':supervisor',
    ':application',
    ':crypto',
    ':ssl',
    ':timer',
    ':io',
    ':file',
    ':lists',
    ':maps',
    ':string',
    ':binary',
    ':os',
    ':calendar',
    ':math',
    ':rand',
    ':unicode',
    ':httpc',
    ':inets',
    ':xmerl',
    ':public_key',
    ':ssh',
    ':logger',
]);

const DART_FRAMEWORK_PACKAGES = new Set([
    'flutter',
    'flutter_test',
    'flutter_driver',
    'flutter_localizations',
    'flutter_web_plugins',
    'sky_engine',
]);

const SWIFT_FRAMEWORKS = new Set([
    'Foundation',
    'Swift',
    'SwiftUI',
    'Combine',
    'Observation',
    'UIKit',
    'AppKit',
    'WatchKit',
    'WidgetKit',
    'CoreData',
    'SwiftData',
    'CloudKit',
    'Network',
    'WebKit',
    'AVFoundation',
    'AVKit',
    'CoreGraphics',
    'CoreImage',
    'CoreAnimation',
    'QuartzCore',
    'Metal',
    'MetalKit',
    'SpriteKit',
    'SceneKit',
    'RealityKit',
    'ARKit',
    'Vision',
    'CoreML',
    'CreateML',
    'NaturalLanguage',
    'CoreLocation',
    'MapKit',
    'CoreBluetooth',
    'CoreMotion',
    'CoreTelephony',
    'CoreNFC',
    'LocalAuthentication',
    'Security',
    'CryptoKit',
    'UserNotifications',
    'BackgroundTasks',
    'Accessibility',
    'StoreKit',
    'GameKit',
    'HealthKit',
    'HomeKit',
    'EventKit',
    'Contacts',
    'ContactsUI',
    'MessageUI',
    'Messages',
    'MultipeerConnectivity',
    'Photos',
    'PhotosUI',
    'XCTest',
    'Testing',
    'os',
    'Darwin',
    'Dispatch',
    'ObjectiveC',
    'PlaygroundSupport',
    'PackageDescription',
]);

// ---------------------------------------------------------------------------
// Manifest parsers
// ---------------------------------------------------------------------------

function safeRead(filePath: string): string | null {
    if (!cachedExists(filePath)) {
        return null;
    }
    try {
        return readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

function safeParseJson(filePath: string): Record<string, unknown> | null {
    const text = safeRead(filePath);
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function loadNodeDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const pkg = safeParseJson(join(repoRoot, 'package.json'));
    if (pkg) {
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            const deps = pkg[field];
            if (deps && typeof deps === 'object') {
                for (const name of Object.keys(deps as Record<string, unknown>)) {
                    pkgs.add(name);
                }
            }
        }
    }
    return { packages: pkgs };
}

function loadPythonDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();

    // requirements.txt
    const reqText = safeRead(join(repoRoot, 'requirements.txt'));
    if (reqText) {
        for (const line of reqText.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
                continue;
            }
            // Strip version specifiers: django>=4.0 -> django
            const name = trimmed
                .split(/[>=<!~;\s[]/)[0]
                .trim()
                .toLowerCase()
                .replace(/-/g, '_');
            if (name) {
                pkgs.add(name);
            }
        }
    }

    // pyproject.toml — simple line-based parsing
    const pyproject = safeRead(join(repoRoot, 'pyproject.toml'));
    if (pyproject) {
        let inDeps = false;
        for (const line of pyproject.split('\n')) {
            const trimmed = line.trim();
            if (
                /^\[(project|tool\.poetry)\.?dependencies\]$/i.test(trimmed) ||
                trimmed === '[project]' ||
                trimmed === '[tool.poetry.dependencies]'
            ) {
                inDeps = true;
                continue;
            }
            if (trimmed.startsWith('[') && inDeps) {
                inDeps = false;
                continue;
            }
            if (inDeps) {
                // TOML key = value or "name>=version" in a list
                const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/);
                if (match) {
                    const name = match[1].toLowerCase().replace(/-/g, '_');
                    if (name !== 'python') {
                        pkgs.add(name);
                    }
                }
                // List items: "django>=4.0"
                const listMatch = trimmed.match(/^"([a-zA-Z0-9_-]+)/);
                if (listMatch) {
                    pkgs.add(listMatch[1].toLowerCase().replace(/-/g, '_'));
                }
            }
        }
    }

    return { packages: pkgs };
}

function loadGoDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const meta: Record<string, string> = {};
    const gomod = safeRead(join(repoRoot, 'go.mod'));
    if (gomod) {
        // Extract module name
        const modMatch = gomod.match(/^module\s+(.+)$/m);
        if (modMatch) {
            meta.module = modMatch[1].trim();
        }
        // Extract require block
        let inRequire = false;
        for (const line of gomod.split('\n')) {
            const trimmed = line.trim();
            if (trimmed === 'require (') {
                inRequire = true;
                continue;
            }
            if (trimmed === ')') {
                inRequire = false;
                continue;
            }
            if (inRequire) {
                const match = trimmed.match(/^(\S+)\s+/);
                if (match) {
                    pkgs.add(match[1]);
                }
            }
            // Single-line require
            const singleMatch = trimmed.match(/^require\s+(\S+)\s+/);
            if (singleMatch) {
                pkgs.add(singleMatch[1]);
            }
        }
    }
    return { packages: pkgs, meta };
}

function loadRustDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const cargo = safeRead(join(repoRoot, 'Cargo.toml'));
    if (cargo) {
        let inDeps = false;
        for (const line of cargo.split('\n')) {
            const trimmed = line.trim();
            if (/^\[(.*dependencies.*)\]$/i.test(trimmed)) {
                inDeps = true;
                continue;
            }
            if (trimmed.startsWith('[') && inDeps) {
                inDeps = false;
                continue;
            }
            if (inDeps) {
                const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=/);
                if (match) {
                    pkgs.add(match[1]);
                }
            }
        }
    }
    return { packages: pkgs };
}

function loadJavaDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();

    // pom.xml — simple regex-based parsing
    const pom = safeRead(join(repoRoot, 'pom.xml'));
    if (pom) {
        const depRegex = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/gs;
        let m: RegExpExecArray | null = depRegex.exec(pom);
        while (m !== null) {
            // Store as "groupId:artifactId" for later matching
            pkgs.add(`${m[1]}:${m[2]}`);
            m = depRegex.exec(pom);
        }
    }

    // build.gradle — basic regex
    const gradle = safeRead(join(repoRoot, 'build.gradle'));
    const gradleKts = safeRead(join(repoRoot, 'build.gradle.kts'));
    for (const text of [gradle, gradleKts]) {
        if (!text) {
            continue;
        }
        // Matches: implementation 'group:artifact:version' or "group:artifact:version"
        const regex = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s+['"]([^'"]+)['"]/g;
        let gm: RegExpExecArray | null = regex.exec(text);
        while (gm !== null) {
            const parts = gm[1].split(':');
            if (parts.length >= 2) {
                pkgs.add(`${parts[0]}:${parts[1]}`);
            }
            gm = regex.exec(text);
        }
    }

    return { packages: pkgs };
}

function loadPhpDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const composer = safeParseJson(join(repoRoot, 'composer.json'));
    if (composer) {
        for (const field of ['require', 'require-dev']) {
            const deps = composer[field];
            if (deps && typeof deps === 'object') {
                for (const name of Object.keys(deps as Record<string, unknown>)) {
                    if (name === 'php') {
                        continue;
                    }
                    pkgs.add(name);
                }
            }
        }
    }
    return { packages: pkgs };
}

function loadRubyDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const gemfile = safeRead(join(repoRoot, 'Gemfile'));
    if (gemfile) {
        const regex = /gem\s+['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null = regex.exec(gemfile);
        while (m !== null) {
            pkgs.add(m[1]);
            m = regex.exec(gemfile);
        }
    }
    return { packages: pkgs };
}

function loadDartDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const meta: Record<string, string> = {};
    const pubspec = safeRead(join(repoRoot, 'pubspec.yaml'));
    if (pubspec) {
        // Extract package name
        const nameMatch = pubspec.match(/^name:\s*(.+)$/m);
        if (nameMatch) {
            meta.name = nameMatch[1].trim();
        }

        // Extract dependency names (simple line-based parsing)
        let inDeps = false;
        for (const line of pubspec.split('\n')) {
            const trimmed = line.trim();
            if (/^(dependencies|dev_dependencies|dependency_overrides):/.test(trimmed)) {
                inDeps = true;
                continue;
            }
            // New top-level key — stop collecting
            if (/^[a-zA-Z_].*:/.test(trimmed) && !trimmed.startsWith(' ') && !trimmed.startsWith('#')) {
                if (inDeps) {
                    inDeps = false;
                }
                continue;
            }
            if (inDeps) {
                const depMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
                if (depMatch) {
                    pkgs.add(depMatch[1]);
                }
            }
        }
    }
    return { packages: pkgs, meta };
}

function loadSwiftDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const packageSwift = safeRead(join(repoRoot, 'Package.swift'));
    if (packageSwift) {
        // Extract SPM dependencies from Package.swift
        // Matches: .package(url: "https://github.com/org/Name.git", ...) or .package(name: "Name", ...)
        const urlRegex = /\.package\(\s*(?:name:\s*"([^"]+)",\s*)?url:\s*"([^"]+)"/g;
        let m: RegExpExecArray | null = urlRegex.exec(packageSwift);
        while (m !== null) {
            if (m[1]) {
                pkgs.add(m[1]);
            } else if (m[2]) {
                // Extract package name from URL: https://github.com/org/Name.git -> Name
                const urlParts = m[2].replace(/\.git$/, '').split('/');
                const name = urlParts[urlParts.length - 1];
                if (name) {
                    pkgs.add(name);
                }
            }
            m = urlRegex.exec(packageSwift);
        }
    }
    return { packages: pkgs };
}

function loadElixirDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const mixExs = safeRead(join(repoRoot, 'mix.exs'));
    if (mixExs) {
        // Match {:dep_name, "~> version"} or {:dep_name, ">= version"}
        // or {:dep_name, git: "..."} etc.
        const regex = /\{:([a-z_][a-z0-9_]*)\s*,/g;
        let m: RegExpExecArray | null = regex.exec(mixExs);
        while (m !== null) {
            pkgs.add(m[1]);
            m = regex.exec(mixExs);
        }
    }
    return { packages: pkgs };
}

function loadCsharpDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    // Find .csproj files at root or one level deep
    const candidates: string[] = [];
    try {
        const entries = require('fs').readdirSync(repoRoot);
        for (const e of entries) {
            if (e.endsWith('.csproj')) {
                candidates.push(join(repoRoot, e));
            }
        }
    } catch {
        /* ignore */
    }

    for (const csproj of candidates) {
        const text = safeRead(csproj);
        if (!text) {
            continue;
        }
        const regex = /<PackageReference\s+Include="([^"]+)"/gi;
        let m: RegExpExecArray | null = regex.exec(text);
        while (m !== null) {
            pkgs.add(m[1]);
            m = regex.exec(text);
        }
    }
    return { packages: pkgs };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function loadDeps(repoRoot: string): Map<string, LangDeps> {
    const cached = depsCache.get(repoRoot);
    if (cached) {
        return cached;
    }

    const result = new Map<string, LangDeps>();

    // TypeScript / JavaScript
    if (cachedExists(join(repoRoot, 'package.json'))) {
        const nodeDeps = loadNodeDeps(repoRoot);
        result.set('typescript', nodeDeps);
        result.set('javascript', nodeDeps);
        result.set('ts', nodeDeps);
    }

    // Python
    if (cachedExists(join(repoRoot, 'requirements.txt')) || cachedExists(join(repoRoot, 'pyproject.toml'))) {
        result.set('python', loadPythonDeps(repoRoot));
    }

    // Go
    if (cachedExists(join(repoRoot, 'go.mod'))) {
        result.set('go', loadGoDeps(repoRoot));
    }

    // Rust
    if (cachedExists(join(repoRoot, 'Cargo.toml'))) {
        result.set('rust', loadRustDeps(repoRoot));
    }

    // Java
    if (
        cachedExists(join(repoRoot, 'pom.xml')) ||
        cachedExists(join(repoRoot, 'build.gradle')) ||
        cachedExists(join(repoRoot, 'build.gradle.kts')) ||
        cachedExists(join(repoRoot, 'build.sbt'))
    ) {
        const javaDeps = loadJavaDeps(repoRoot);
        result.set('java', javaDeps);
        // Kotlin shares Java's build systems (Maven/Gradle)
        result.set('kotlin', javaDeps);
        // Scala shares Java's build systems (Maven/Gradle/SBT)
        result.set('scala', javaDeps);
    }

    // PHP
    if (cachedExists(join(repoRoot, 'composer.json'))) {
        result.set('php', loadPhpDeps(repoRoot));
    }

    // Ruby
    if (cachedExists(join(repoRoot, 'Gemfile'))) {
        result.set('ruby', loadRubyDeps(repoRoot));
    }

    // Swift
    if (cachedExists(join(repoRoot, 'Package.swift'))) {
        result.set('swift', loadSwiftDeps(repoRoot));
    }

    // Dart
    if (cachedExists(join(repoRoot, 'pubspec.yaml'))) {
        result.set('dart', loadDartDeps(repoRoot));
    }

    // Elixir
    if (cachedExists(join(repoRoot, 'mix.exs'))) {
        result.set('elixir', loadElixirDeps(repoRoot));
    }

    // C#
    result.set('csharp', loadCsharpDeps(repoRoot));

    depsCache.set(repoRoot, result);
    return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if an import is an external (third-party) package.
 * Returns the package name if external, null if not detected as external.
 */
export function detectExternal(modulePath: string, lang: string, repoRoot: string): string | null {
    // Normalize language key
    const langKey = lang === 'ts' ? 'typescript' : lang;

    // ----- TypeScript / JavaScript -----
    if (langKey === 'typescript' || langKey === 'javascript') {
        // Relative imports are never external
        if (modulePath.startsWith('.') || modulePath.startsWith('#')) {
            return null;
        }

        // Node builtin (with or without node: prefix)
        if (modulePath.startsWith('node:')) {
            return modulePath;
        }
        if (modulePath.startsWith('bun:')) {
            return modulePath;
        }
        if (NODE_BUILTINS.has(modulePath)) {
            return modulePath;
        }
        // Also handle node:XXX/subpath
        const bareNode = modulePath.split('/')[0];
        if (NODE_BUILTINS.has(bareNode)) {
            return bareNode;
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('typescript');
        if (!langDeps) {
            return null;
        }

        // Scoped package: @scope/name or @scope/name/subpath
        if (modulePath.startsWith('@')) {
            const parts = modulePath.split('/');
            const scopedName = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : modulePath;
            if (langDeps.packages.has(scopedName)) {
                return scopedName;
            }
            // Bare specifier not in deps but doesn't start with . or # → likely external
            return scopedName;
        }

        // Non-scoped: bare specifier
        const topLevel = modulePath.split('/')[0];
        if (langDeps.packages.has(topLevel)) {
            return topLevel;
        }

        // Bare specifier not found in deps — still likely external (unlisted dep)
        return topLevel;
    }

    // ----- Python -----
    if (langKey === 'python') {
        // Relative imports start with .
        if (modulePath.startsWith('.')) {
            return null;
        }

        const topLevel = modulePath.split('.')[0].toLowerCase().replace(/-/g, '_');

        // Python stdlib
        if (PYTHON_STDLIB.has(topLevel)) {
            return topLevel;
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('python');
        if (!langDeps) {
            // No manifest found — check stdlib only
            return PYTHON_STDLIB.has(topLevel) ? topLevel : null;
        }

        if (langDeps.packages.has(topLevel)) {
            return topLevel;
        }
        return null;
    }

    // ----- Go -----
    if (langKey === 'go') {
        // Go stdlib: no dot in first segment
        const firstSegment = modulePath.split('/')[0];
        if (!firstSegment.includes('.')) {
            return modulePath;
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('go');
        if (!langDeps) {
            return null;
        }

        // Check if it's the project's own module
        const ownModule = langDeps.meta?.module;
        if (ownModule && modulePath.startsWith(ownModule)) {
            return null;
        }

        // Check require list — match prefix
        for (const dep of langDeps.packages) {
            if (modulePath === dep || modulePath.startsWith(`${dep}/`)) {
                return dep;
            }
        }

        // Has a dot in first segment but not in require list — still likely external
        return modulePath;
    }

    // ----- Rust -----
    if (langKey === 'rust') {
        const firstSegment = modulePath.split('::')[0];

        // crate:: and super:: and self:: are local
        if (firstSegment === 'crate' || firstSegment === 'super' || firstSegment === 'self') {
            return null;
        }

        // stdlib crates
        if (RUST_STDLIB_CRATES.has(firstSegment)) {
            return firstSegment;
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('rust');
        if (!langDeps) {
            return null;
        }

        // Cargo dependency names use hyphens but Rust uses underscores
        const normalized = firstSegment.replace(/-/g, '_');
        for (const dep of langDeps.packages) {
            if (dep.replace(/-/g, '_') === normalized) {
                return dep;
            }
        }

        return null;
    }

    // ----- Java -----
    if (langKey === 'java') {
        // Java stdlib
        for (const prefix of JAVA_STDLIB_PREFIXES) {
            if (modulePath.startsWith(prefix)) {
                // Return the first two segments (e.g. java.util)
                const parts = modulePath.split('.');
                return parts.slice(0, 2).join('.');
            }
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('java');
        if (!langDeps) {
            return null;
        }

        // Match groupId prefix against import path
        // e.g. groupId "org.springframework.boot" -> import "org.springframework.boot.SpringApplication"
        for (const dep of langDeps.packages) {
            const [groupId, artifactId] = dep.split(':');
            if (modulePath.startsWith(groupId)) {
                return artifactId;
            }
        }

        return null;
    }

    // ----- Kotlin -----
    if (langKey === 'kotlin') {
        // Kotlin stdlib (includes Java stdlib prefixes)
        for (const prefix of KOTLIN_STDLIB_PREFIXES) {
            if (modulePath.startsWith(prefix)) {
                const parts = modulePath.split('.');
                return parts.slice(0, 2).join('.');
            }
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('kotlin');
        if (!langDeps) {
            return null;
        }

        // Same as Java: match groupId prefix against import path
        for (const dep of langDeps.packages) {
            const [groupId, artifactId] = dep.split(':');
            if (modulePath.startsWith(groupId)) {
                return artifactId;
            }
        }

        return null;
    }

    // ----- Scala -----
    if (langKey === 'scala') {
        // Scala stdlib (includes Java stdlib prefixes + Scala ecosystem)
        for (const prefix of SCALA_STDLIB_PREFIXES) {
            if (modulePath.startsWith(prefix)) {
                const parts = modulePath.split('.');
                return parts.slice(0, 2).join('.');
            }
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('scala');
        if (!langDeps) {
            return null;
        }

        // Same as Java/Kotlin: match groupId prefix against import path
        for (const dep of langDeps.packages) {
            const [groupId, artifactId] = dep.split(':');
            if (modulePath.startsWith(groupId)) {
                return artifactId;
            }
        }

        return null;
    }

    // ----- PHP -----
    if (langKey === 'php') {
        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('php');
        if (!langDeps) {
            return null;
        }

        // Get composer.json autoload info for local namespace detection
        const composer = safeParseJson(join(repoRoot, 'composer.json'));
        if (composer) {
            const autoload = composer.autoload as Record<string, unknown> | undefined;
            if (autoload) {
                const psr4 = autoload['psr-4'] as Record<string, unknown> | undefined;
                if (psr4) {
                    // Normalize import path separators
                    const normalized = modulePath.replace(/\//g, '\\');
                    for (const ns of Object.keys(psr4)) {
                        if (normalized.startsWith(ns)) {
                            return null; // local namespace
                        }
                    }
                }
            }
        }

        // Check known package → namespace mappings
        // Common Composer package namespace mappings
        const COMPOSER_NS_MAP: Record<string, string[]> = {
            'laravel/framework': ['Illuminate\\'],
            'guzzlehttp/guzzle': ['GuzzleHttp\\'],
            'symfony/console': ['Symfony\\Component\\Console\\'],
            'symfony/http-foundation': ['Symfony\\Component\\HttpFoundation\\'],
            'monolog/monolog': ['Monolog\\'],
            'doctrine/orm': ['Doctrine\\ORM\\'],
            'phpunit/phpunit': ['PHPUnit\\'],
        };

        const normalized = modulePath.replace(/\//g, '\\');
        for (const dep of langDeps.packages) {
            const namespaces = COMPOSER_NS_MAP[dep];
            if (namespaces) {
                for (const ns of namespaces) {
                    if (normalized.startsWith(ns)) {
                        return dep;
                    }
                }
            }
        }

        return null;
    }

    // ----- Ruby -----
    if (langKey === 'ruby') {
        // Ruby stdlib
        if (RUBY_STDLIB.has(modulePath)) {
            return modulePath;
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('ruby');
        if (!langDeps) {
            return null;
        }

        if (langDeps.packages.has(modulePath)) {
            return modulePath;
        }

        return null;
    }

    // ----- C# -----
    if (langKey === 'csharp') {
        // Framework namespaces
        if (
            modulePath.startsWith('System.') ||
            modulePath === 'System' ||
            modulePath.startsWith('Microsoft.') ||
            modulePath === 'Microsoft'
        ) {
            return modulePath.split('.').slice(0, 2).join('.');
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('csharp');
        if (!langDeps) {
            return null;
        }

        // Match PackageReference names against import namespace
        for (const dep of langDeps.packages) {
            if (modulePath.startsWith(dep)) {
                return dep;
            }
        }

        return null;
    }

    // ----- Dart -----
    if (langKey === 'dart') {
        // SDK imports: dart:xxx
        if (modulePath.startsWith('dart:')) {
            return modulePath;
        }

        // Framework packages
        if (modulePath.startsWith('package:')) {
            const withoutPrefix = modulePath.slice('package:'.length);
            const packageName = withoutPrefix.split('/')[0];

            if (DART_FRAMEWORK_PACKAGES.has(packageName)) {
                return packageName;
            }

            // Check if it's the project's own package
            const deps = loadDeps(repoRoot);
            const langDeps = deps.get('dart');
            if (langDeps?.meta?.name === packageName) {
                return null; // own package, not external
            }

            if (langDeps?.packages.has(packageName)) {
                return packageName;
            }

            return null;
        }

        // Relative imports are never external
        if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
            return null;
        }

        return null;
    }

    // ----- Swift -----
    if (langKey === 'swift') {
        // Framework/system imports
        if (SWIFT_FRAMEWORKS.has(modulePath)) {
            return modulePath;
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('swift');
        if (!langDeps) {
            return null;
        }

        if (langDeps.packages.has(modulePath)) {
            return modulePath;
        }

        return null;
    }

    // ----- Elixir -----
    if (langKey === 'elixir') {
        // Check Elixir/Erlang stdlib
        const topSegment = modulePath.split('.')[0];
        if (ELIXIR_STDLIB_MODULES.has(topSegment) || ELIXIR_STDLIB_MODULES.has(modulePath)) {
            return topSegment;
        }

        // Erlang atoms start with ':'
        if (modulePath.startsWith(':')) {
            if (ELIXIR_STDLIB_MODULES.has(modulePath)) {
                return modulePath;
            }
            // Erlang module not in known list — likely external
            return null;
        }

        const deps = loadDeps(repoRoot);
        const langDeps = deps.get('elixir');
        if (!langDeps) {
            return null;
        }

        // Elixir deps are atom names like :ecto, :phoenix, :plug
        // Module names use CamelCase: Ecto.Query → dep name is "ecto"
        const depName = topSegment.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        if (langDeps.packages.has(depName)) {
            return depName;
        }

        return null;
    }

    // ----- C / C++ -----
    if (langKey === 'c' || langKey === 'cpp') {
        // The extractor stores include paths without angle brackets or quotes.
        // System headers are identified by common system header names or
        // well-known standard library headers.
        // Since we can't distinguish <> from "" at this point, we check
        // if the path matches known system/stdlib headers.
        const C_SYSTEM_HEADERS = new Set([
            'stdio.h',
            'stdlib.h',
            'string.h',
            'math.h',
            'time.h',
            'errno.h',
            'assert.h',
            'ctype.h',
            'float.h',
            'limits.h',
            'locale.h',
            'setjmp.h',
            'signal.h',
            'stdarg.h',
            'stddef.h',
            'stdint.h',
            'stdbool.h',
            'wchar.h',
            'wctype.h',
            'complex.h',
            'fenv.h',
            'inttypes.h',
            'iso646.h',
            'tgmath.h',
            'uchar.h',
            'threads.h',
            'stdatomic.h',
            'stdalign.h',
            'stdnoreturn.h',
            'unistd.h',
            'fcntl.h',
            'sys/types.h',
            'sys/stat.h',
            'sys/socket.h',
            'netinet/in.h',
            'arpa/inet.h',
            'pthread.h',
            'dirent.h',
            'dlfcn.h',
            'semaphore.h',
        ]);

        const CPP_SYSTEM_HEADERS = new Set([
            'string',
            'vector',
            'map',
            'set',
            'unordered_map',
            'unordered_set',
            'list',
            'deque',
            'queue',
            'stack',
            'array',
            'bitset',
            'forward_list',
            'iostream',
            'fstream',
            'sstream',
            'iomanip',
            'ostream',
            'istream',
            'algorithm',
            'numeric',
            'functional',
            'iterator',
            'ranges',
            'memory',
            'utility',
            'tuple',
            'optional',
            'variant',
            'any',
            'type_traits',
            'typeinfo',
            'typeindex',
            'chrono',
            'thread',
            'mutex',
            'condition_variable',
            'future',
            'atomic',
            'exception',
            'stdexcept',
            'system_error',
            'cerrno',
            'cstdio',
            'cstdlib',
            'cstring',
            'cmath',
            'ctime',
            'cassert',
            'cctype',
            'climits',
            'cfloat',
            'cstdint',
            'cstddef',
            'regex',
            'random',
            'ratio',
            'complex',
            'valarray',
            'filesystem',
            'span',
            'format',
            'source_location',
            'concepts',
            'coroutine',
            'expected',
            'print',
            'new',
            'limits',
            'locale',
            'codecvt',
            'initializer_list',
            'compare',
        ]);

        if (C_SYSTEM_HEADERS.has(modulePath) || CPP_SYSTEM_HEADERS.has(modulePath)) {
            return modulePath;
        }

        // Anything that doesn't end in a file extension is likely a C++ standard header
        if (!modulePath.includes('.')) {
            return modulePath;
        }

        return null;
    }

    return null;
}
