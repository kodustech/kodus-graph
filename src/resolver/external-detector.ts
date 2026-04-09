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

const RUST_STDLIB_CRATES = new Set(['std', 'core', 'alloc']);

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
        cachedExists(join(repoRoot, 'build.gradle.kts'))
    ) {
        result.set('java', loadJavaDeps(repoRoot));
    }

    // PHP
    if (cachedExists(join(repoRoot, 'composer.json'))) {
        result.set('php', loadPhpDeps(repoRoot));
    }

    // Ruby
    if (cachedExists(join(repoRoot, 'Gemfile'))) {
        result.set('ruby', loadRubyDeps(repoRoot));
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

    return null;
}
