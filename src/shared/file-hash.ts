import { createHash } from 'crypto';
import { readFileSync } from 'fs';

export function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}
