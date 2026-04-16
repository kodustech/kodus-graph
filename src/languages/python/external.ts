/**
 * Python external-package detection.
 *
 * Relative imports (starting with `.`) are local. The top-level segment of
 * an absolute import is matched against the Python stdlib set and against
 * any packages declared in requirements.txt or pyproject.toml.
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

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

function loadDeps(repoRoot: string): LangDeps {
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

function hasManifest(repoRoot: string): boolean {
    return cachedExists(join(repoRoot, 'requirements.txt')) || cachedExists(join(repoRoot, 'pyproject.toml'));
}

export function detect(modulePath: string, repoRoot: string): string | null {
    // Relative imports start with .
    if (modulePath.startsWith('.')) {
        return null;
    }

    const topLevel = modulePath.split('.')[0].toLowerCase().replace(/-/g, '_');

    // Python stdlib
    if (PYTHON_STDLIB.has(topLevel)) {
        return topLevel;
    }

    // No manifest? Can only rely on stdlib set (already checked above)
    if (!hasManifest(repoRoot)) {
        return null;
    }

    const deps = getOrLoadDeps('python', repoRoot, () => loadDeps(repoRoot));
    if (deps.packages.has(topLevel)) {
        return topLevel;
    }
    return null;
}
