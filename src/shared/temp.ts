import { randomBytes } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Create a secure temp directory + file path.
 * Directory is created with 0700 permissions via mkdtempSync.
 * File name uses crypto.randomBytes for unpredictability.
 *
 * Caller is responsible for cleanup (rmSync(dir, { recursive: true, force: true })).
 */
export function createSecureTempFile(prefix: string): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), `kodus-graph-${prefix}-`));
  const filePath = join(dir, `${randomBytes(8).toString('hex')}.json`);
  return { dir, filePath };
}
