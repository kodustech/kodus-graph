/**
 * C# external-package detection.
 *
 * System.* / Microsoft.* namespaces are treated as framework. Remaining
 * imports are matched against PackageReference entries in any .csproj
 * files found at the repo root.
 */

import { readdirSync } from 'fs';
import { join } from 'path';
import { getOrLoadDeps, type LangDeps, safeRead } from '../external-shared';

function loadDeps(repoRoot: string): LangDeps {
    const pkgs = new Set<string>();
    const candidates: string[] = [];
    try {
        const entries = readdirSync(repoRoot);
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

export function detect(modulePath: string, repoRoot: string): string | null {
    // Framework namespaces
    if (
        modulePath.startsWith('System.') ||
        modulePath === 'System' ||
        modulePath.startsWith('Microsoft.') ||
        modulePath === 'Microsoft'
    ) {
        return modulePath.split('.').slice(0, 2).join('.');
    }

    const deps = getOrLoadDeps('csharp', repoRoot, () => loadDeps(repoRoot));

    // Match PackageReference names against import namespace
    for (const dep of deps.packages) {
        if (modulePath.startsWith(dep)) {
            return dep;
        }
    }

    return null;
}
