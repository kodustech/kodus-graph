import { createHash } from 'crypto';
import { readFileSync } from 'fs';

export function computeFileHash(filePath: string): string {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
}

/** Hash a node's source text (function body, class body, etc.) */
export function computeContentHash(sourceText: string): string {
    return createHash('sha256').update(sourceText).digest('hex');
}
