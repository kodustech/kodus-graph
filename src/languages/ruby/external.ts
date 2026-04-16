/**
 * Ruby external-gem detection.
 *
 * Ruby stdlib names match directly. Gemfile contents are parsed for gem
 * declarations and compared against the full module path.
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

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

function loadDeps(repoRoot: string): LangDeps {
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

export function detect(modulePath: string, repoRoot: string): string | null {
    if (RUBY_STDLIB.has(modulePath)) {
        return modulePath;
    }

    if (!cachedExists(join(repoRoot, 'Gemfile'))) {
        return null;
    }

    const deps = getOrLoadDeps('ruby', repoRoot, () => loadDeps(repoRoot));
    if (deps.packages.has(modulePath)) {
        return modulePath;
    }
    return null;
}
