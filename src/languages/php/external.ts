/**
 * PHP external-package detection.
 *
 * Uses composer.json: deps are matched via a built-in Composer package →
 * namespace mapping. psr-4 autoload entries mark local namespaces.
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeParseJson } from '../external-shared';

function loadDeps(repoRoot: string): LangDeps {
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

// Common Composer package → namespace mappings
const COMPOSER_NS_MAP: Record<string, string[]> = {
    'laravel/framework': ['Illuminate\\'],
    'guzzlehttp/guzzle': ['GuzzleHttp\\'],
    'symfony/console': ['Symfony\\Component\\Console\\'],
    'symfony/http-foundation': ['Symfony\\Component\\HttpFoundation\\'],
    'monolog/monolog': ['Monolog\\'],
    'doctrine/orm': ['Doctrine\\ORM\\'],
    'phpunit/phpunit': ['PHPUnit\\'],
};

export function detect(modulePath: string, repoRoot: string): string | null {
    if (!cachedExists(join(repoRoot, 'composer.json'))) {
        return null;
    }

    const deps = getOrLoadDeps('php', repoRoot, () => loadDeps(repoRoot));

    // psr-4 autoload info identifies local namespaces
    const composer = safeParseJson(join(repoRoot, 'composer.json'));
    if (composer) {
        const autoload = composer.autoload as Record<string, unknown> | undefined;
        if (autoload) {
            const psr4 = autoload['psr-4'] as Record<string, unknown> | undefined;
            if (psr4) {
                const normalized = modulePath.replace(/\//g, '\\');
                for (const ns of Object.keys(psr4)) {
                    if (normalized.startsWith(ns)) {
                        return null; // local namespace
                    }
                }
            }
        }
    }

    const normalized = modulePath.replace(/\//g, '\\');
    for (const dep of deps.packages) {
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
