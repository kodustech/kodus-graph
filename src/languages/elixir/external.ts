/**
 * Elixir external-dependency detection.
 *
 * Elixir and Erlang stdlib modules are detected first. Remaining module
 * names are normalised (CamelCase → snake_case) and checked against
 * mix.exs dependency atoms.
 */

import { join } from 'path';
import { cachedExists } from '../../resolver/fs-cache';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

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

function loadDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const mixExs = safeRead(join(repoRoot, 'mix.exs'));
    if (mixExs) {
        // Match {:dep_name, "~> version"} or {:dep_name, ">= version"}
        const regex = /\{:([a-z_][a-z0-9_]*)\s*,/g;
        let m: RegExpExecArray | null = regex.exec(mixExs);
        while (m !== null) {
            pkgs.add(m[1]);
            m = regex.exec(mixExs);
        }
    }
    return { packages: pkgs };
}

export function detect(modulePath: string, repoRoot: string): string | null {
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

    if (!cachedExists(join(repoRoot, 'mix.exs'))) {
        return null;
    }

    const deps = getOrLoadDeps('elixir', repoRoot, () => loadDeps(repoRoot));

    // Elixir deps are atom names (:ecto, :phoenix, :plug). Module names use
    // CamelCase → convert "Ecto.Query" → "ecto".
    const depName = topSegment.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    if (deps.packages.has(depName)) {
        return depName;
    }
    return null;
}
