// tests/parser/call-extraction.test.ts
import { describe, it, expect } from 'bun:test';
import { parseAsync, Lang } from '@ast-grep/napi';
import { extractCallsFromTypeScript } from '../../src/parser/extractors/typescript';
import type { RawCallSite } from '../../src/graph/types';

// Import to trigger language registration
import '../../src/parser/languages';

describe('extractCallsFromTypeScript', () => {
  async function extractCalls(source: string, fp: string = 'src/test.ts'): Promise<RawCallSite[]> {
    const root = await parseAsync(Lang.TypeScript, source);
    const calls: RawCallSite[] = [];
    extractCallsFromTypeScript(root, fp, calls);
    return calls;
  }

  it('should extract direct function calls', async () => {
    const source = `
      import { validate } from './auth';
      function main() {
        validate(token);
        processData(input);
      }
    `;
    const calls = await extractCalls(source);
    const names = calls.map(c => c.callName);
    expect(names).toContain('validate');
    expect(names).toContain('processData');
  });

  it('should extract DI calls with diField', async () => {
    const source = `
      class Controller {
        constructor(private authService: AuthService) {}
        handle() {
          this.authService.validate(token);
        }
      }
    `;
    const calls = await extractCalls(source);
    const diCall = calls.find(c => c.callName === 'validate');
    expect(diCall).toBeDefined();
    expect(diCall!.diField).toBe('authService');
    expect(diCall!.source).toBe('src/test.ts');
  });

  it('should filter NOISE functions', async () => {
    const source = `
      console.log('hello');
      arr.push(item);
      arr.map(x => x);
      realFunction(arg);
    `;
    const calls = await extractCalls(source);
    const names = calls.map(c => c.callName);
    expect(names).not.toContain('log');
    expect(names).not.toContain('push');
    expect(names).not.toContain('map');
    expect(names).toContain('realFunction');
  });

  it('should set correct line numbers', async () => {
    const source = `const x = 1;\nconst y = 2;\nmyFunc(x, y);\n`;
    const calls = await extractCalls(source);
    const call = calls.find(c => c.callName === 'myFunc');
    expect(call).toBeDefined();
    expect(call!.line).toBe(2); // 0-indexed line
  });

  it('should not set diField for non-DI calls', async () => {
    const source = `doSomething(arg);`;
    const calls = await extractCalls(source);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].diField).toBeUndefined();
  });
});
