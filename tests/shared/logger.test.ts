// tests/shared/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { log } from '../../src/shared/logger';

describe('logger', () => {
  let stderrOutput: string;
  const originalWrite = process.stderr.write;

  beforeEach(() => {
    stderrOutput = '';
    process.stderr.write = ((chunk: string) => {
      stderrOutput += chunk;
      return true;
    }) as typeof process.stderr.write;
    delete process.env.KODUS_GRAPH_DEBUG;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    delete process.env.KODUS_GRAPH_DEBUG;
  });

  it('should write warn messages to stderr', () => {
    log.warn('test warning');
    expect(stderrOutput).toContain('[WARN] test warning');
  });

  it('should write error messages to stderr', () => {
    log.error('test error');
    expect(stderrOutput).toContain('[ERROR] test error');
  });

  it('should include context object in output', () => {
    log.warn('file failed', { file: 'src/a.ts', error: 'ENOENT' });
    expect(stderrOutput).toContain('[WARN] file failed');
    expect(stderrOutput).toContain('"file":"src/a.ts"');
  });

  it('should NOT write debug messages when KODUS_GRAPH_DEBUG is unset', () => {
    log.debug('debug msg');
    expect(stderrOutput).toBe('');
  });

  it('should write debug messages when KODUS_GRAPH_DEBUG is set', () => {
    process.env.KODUS_GRAPH_DEBUG = '1';
    log.debug('debug msg');
    expect(stderrOutput).toContain('[DEBUG] debug msg');
  });
});
