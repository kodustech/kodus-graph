import { readFileSync } from 'fs';
import { createHash } from 'crypto';

export function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}
