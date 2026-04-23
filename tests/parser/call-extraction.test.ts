// tests/parser/call-extraction.test.ts
import { describe, expect, it } from 'bun:test';
import { Lang, parseAsync } from '@ast-grep/napi';
import type { RawCallSite } from '../../src/graph/types';
import { extractCallsFromTypeScript } from '../../src/languages/typescript/extractor';

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

    it('should retain NOISE-named calls (noise is filtered by the resolver, not extraction)', async () => {
        // Noise filtering moved to the resolver (after the receiver-type tier)
        // so user-domain calls like `x.forEach()` or `user.update()` — where
        // the final method name is in the language noise list — aren't dropped
        // before they can be resolved against the symbol table.
        const source = `
      console.log('hello');
      arr.push(item);
      arr.map(x => x);
      realFunction(arg);
    `;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('log');
        expect(names).toContain('push');
        expect(names).toContain('map');
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

import { extractCallsFromPython } from '../../src/languages/python/extractor';
import { extractCallsFromRuby } from '../../src/languages/ruby/extractor';
import { extractCallsFromFile } from '../../src/parser/extractor';

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

    it('should retain NOISE-named calls (noise is filtered by the resolver, not extraction)', async () => {
        // See the TypeScript counterpart: noise filtering moved to the
        // resolver after the receiver-type tier.
        const source = `
print("hello")
real_function(arg)
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('print');
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

    it('should retain NOISE-named calls (noise is filtered by the resolver, not extraction)', async () => {
        const source = `
puts "hello"
real_function(arg)
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('puts');
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

    it('should retain Ruby NOISE-named command-style calls (filtered by resolver, not extraction)', async () => {
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
        expect(names).toContain('puts');
        expect(names).toContain('render');
        expect(names).toContain('redirect_to');
        expect(names).toContain('real_method');
    });
});

import { extractCallsFromPHP } from '../../src/languages/php/extractor';

describe('extractCallsFromPHP', () => {
    async function extractCalls(source: string, fp: string = 'src/test.php'): Promise<RawCallSite[]> {
        const root = await parseAsync('php' as any, source);
        const calls: RawCallSite[] = [];
        extractCallsFromPHP(root.root(), fp, calls);
        return calls;
    }

    it('extracts bare function calls (function_call_expression)', async () => {
        const source = `<?php
function main() {
    validate($token);
    processData($input);
}
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('validate');
        expect(names).toContain('processData');
    });

    it('extracts member calls ($obj->method)', async () => {
        const source = `<?php
function run($svc) {
    $svc->getName();
    $svc->classify(5);
}
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('getName');
        expect(names).toContain('classify');
    });

    it('extracts static calls (Foo::bar())', async () => {
        const source = `<?php
function run() {
    AuthService::validate($token);
    Logger::info("ok");
}
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('validate');
        expect(names).toContain('info');
    });

    it('sets resolveInClass for $this->method() calls', async () => {
        const source = `<?php
class UserService {
    public function greet() {
        return $this->getName();
    }
    public function getName() {
        return "x";
    }
}
`;
        const calls = await extractCalls(source);
        const selfCall = calls.find((c) => c.callName === 'getName');
        expect(selfCall).toBeDefined();
        expect(selfCall!.resolveInClass).toBe('UserService');
    });

    it('sets diField for $this->field->method() DI-style calls', async () => {
        const source = `<?php
class Controller {
    public function handle($token) {
        $this->authService->validate($token);
    }
}
`;
        const calls = await extractCalls(source);
        const diCall = calls.find((c) => c.callName === 'validate');
        expect(diCall).toBeDefined();
        expect(diCall!.diField).toBe('authService');
    });

    it('sets resolveInClass for parent::method() super calls', async () => {
        const source = `<?php
class UserService extends BaseService {
    public function log($msg) {
        parent::log($msg);
    }
}
`;
        const calls = await extractCalls(source);
        const superCall = calls.find((c) => c.callName === 'log' && c.resolveInClass);
        expect(superCall).toBeDefined();
        expect(superCall!.resolveInClass).toBe('BaseService');
    });

    it('retains NOISE-named calls (noise is filtered by the resolver)', async () => {
        const source = `<?php
function main() {
    array_push($arr, 1);
    print_r($x);
    realFunction($y);
}
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('array_push');
        expect(names).toContain('realFunction');
    });

    it('records correct line numbers', async () => {
        const source = `<?php
$a = 1;
myFunc($a);
`;
        const calls = await extractCalls(source);
        const call = calls.find((c) => c.callName === 'myFunc');
        expect(call).toBeDefined();
        expect(call!.line).toBe(2); // 0-indexed — line 3 in source
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
        extractCallsFromFile(root, fp, lang as any, calls);
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

    it('should retain NOISE-named calls (noise is filtered by the resolver, not extraction)', async () => {
        const source = `
package main

func main() {
    fmt.Println("hello")
    realFunction(arg)
}
`;
        const calls = await extractCalls(source);
        const names = calls.map((c) => c.callName);
        expect(names).toContain('Println');
        expect(names).toContain('realFunction');
    });
});
