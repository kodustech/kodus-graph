// tests/parser/call-extraction.test.ts
import { describe, expect, it } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
import { extractCallsFromTypeScript } from '../../src/parser/extractors/typescript';

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
        const names = calls.map((c) => c.callName);
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
        const diCall = calls.find((c) => c.callName === 'validate');
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
        const names = calls.map((c) => c.callName);
        expect(names).not.toContain('log');
        expect(names).not.toContain('push');
        expect(names).not.toContain('map');
        expect(names).toContain('realFunction');
    });

    it('should set correct line numbers', async () => {
        const source = `const x = 1;\nconst y = 2;\nmyFunc(x, y);\n`;
        const calls = await extractCalls(source);
        const call = calls.find((c) => c.callName === 'myFunc');
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

import { extractCallsFromGeneric } from '../../src/parser/extractors/generic';
import { extractCallsFromPython } from '../../src/parser/extractors/python';
import { extractCallsFromRuby } from '../../src/parser/extractors/ruby';

describe('extractCallsFromPython', () => {
    async function extractCalls(source: string, fp: string = 'src/test.py'): Promise<RawCallSite[]> {
        const root = await parseAsync('python' as any, source);
        const calls: RawCallSite[] = [];
        extractCallsFromPython(root, fp, calls);
        return calls;
    }

    it('should extract direct function calls', async () => {
        const source = `
def main():
    validate(token)
    process_data(input)
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('validate');
        expect(names).toContain('process_data');
    });

    it('should filter NOISE functions', async () => {
        const source = `
print("hello")
real_function(arg)
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).not.toContain('print');
        expect(names).toContain('real_function');
    });

    it('should not have diField (Python has no DI pattern)', async () => {
        const source = `do_stuff(arg)\n`;
        const calls = await extractCalls(source);
        if (calls.length > 0) {
            expect(calls[0].diField).toBeUndefined();
        }
    });
});

describe('extractCallsFromRuby', () => {
    async function extractCalls(source: string, fp: string = 'src/test.rb'): Promise<RawCallSite[]> {
        const root = await parseAsync('ruby' as any, source);
        const calls: RawCallSite[] = [];
        extractCallsFromRuby(root, fp, calls);
        return calls;
    }

    it('should extract method calls', async () => {
        const source = `
def main
  validate(token)
  process_data(input)
end
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('validate');
        expect(names).toContain('process_data');
    });

    it('should filter NOISE functions', async () => {
        const source = `
puts "hello"
real_function(arg)
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).not.toContain('puts');
        expect(names).toContain('real_function');
    });

    it('should extract calls without parentheses (command style)', async () => {
        const source = `
class MyController
  def index
    authenticate_user
    load_resources
    process_data(input)
  end
end
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('authenticate_user');
        expect(names).toContain('load_resources');
        expect(names).toContain('process_data');
    });

    it('should extract receiver.method calls without parens', async () => {
        const source = `
class MyService
  def run
    logger.notify "starting"
    self.validate token
    other_service.transform data
  end
end
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('notify');
        expect(names).toContain('validate');
        expect(names).toContain('transform');
        const validateCall = calls.find((c) => c.callName === 'validate');
        expect(validateCall).toBeDefined();
        expect(validateCall!.resolveInClass).toBe('MyService');
    });

    it('should filter Ruby NOISE in command style calls', async () => {
        const source = `
def index
  puts "hello"
  render json: data
  redirect_to root_path
  real_method arg
end
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).not.toContain('puts');
        expect(names).not.toContain('render');
        expect(names).not.toContain('redirect_to');
        expect(names).toContain('real_method');
    });
});

describe('extractCallsFromGeneric', () => {
    async function extractCalls(
        source: string,
        lang: string = 'go',
        fp: string = 'src/test.go',
    ): Promise<RawCallSite[]> {
        const root = await parseAsync(lang as any, source);
        const calls: RawCallSite[] = [];
        extractCallsFromGeneric(root, fp, lang, calls);
        return calls;
    }

    it('should extract function calls from Go code', async () => {
        const source = `
package main

func main() {
    validate(token)
    processData(input)
}
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('validate');
        expect(names).toContain('processData');
    });

    it('should filter NOISE functions', async () => {
        const source = `
package main

func main() {
    fmt.Println("hello")
    realFunction(arg)
}
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).not.toContain('Println');
        expect(names).toContain('realFunction');
    });
});
