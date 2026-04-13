# kodus-graph: Extractor Evolution — Design Spec

## Objetivo

Refatorar o sistema de extraction do kodus-graph para: composable functions por linguagem, novos campos no graph (is_exported, is_async, decorators, throws), e suporte a 5 novas linguagens (Swift, Dart, Scala, C/C++, Elixir). Tudo guiado por reusabilidade, clean code, e extensibilidade.

## Problemas atuais

1. **generic.ts tem 729 linhas** — Go, Java, Rust, C#, PHP, Kotlin misturados num único arquivo com `if (lang === 'go')` branches. Impossível de manter.
2. **Campos úteis não extraídos** — is_exported, is_async, decorators, throws. Hoje um `private` method propaga blast radius igual a um `export` function.
3. **Adicionar linguagem é difícil** — precisa mexer no generic.ts monolítico e entender todo o código pra adicionar um branch.
4. **Sem helpers reusáveis** — cada extractor reimplementa lógica de modifiers, ancestor lookup, etc.

---

## Arquitetura: Composable Functions

### Interface (contrato)

Cada linguagem exporta um objeto que implementa `LanguageExtractors`:

```typescript
// src/parser/extractors/spec.ts

export interface ExtractedClass {
    name: string;
    line_start: number;
    line_end: number;
    extends: string;
    implements: string[];
    modifiers: string;
    decorators: string[];
    is_exported: boolean;
    ast_kind: string;
    content_hash: string;
}

export interface ExtractedFunction {
    name: string;
    line_start: number;
    line_end: number;
    params: string;
    returnType: string;
    kind: 'Function' | 'Method' | 'Constructor';
    className: string;
    modifiers: string;
    decorators: string[];
    is_exported: boolean;
    is_async: boolean;
    throws: string[];
    ast_kind: string;
    content_hash: string;
    isTest: boolean;
}

export interface ExtractedImport {
    module: string;
    line: number;
    names: string[];
    lang: string;
}

export interface ExtractedInterface {
    name: string;
    line_start: number;
    line_end: number;
    methods: string[];
    modifiers: string;
    is_exported: boolean;
    ast_kind: string;
    content_hash: string;
}

export interface ExtractedEnum {
    name: string;
    line_start: number;
    line_end: number;
    modifiers: string;
    is_exported: boolean;
    ast_kind: string;
    content_hash: string;
}

export interface LanguageExtractors {
    extractClasses(root: SgNode, fp: string): ExtractedClass[];
    extractFunctions(root: SgNode, fp: string): ExtractedFunction[];
    extractImports(root: SgNode, fp: string): ExtractedImport[];
    extractInterfaces?(root: SgNode, fp: string): ExtractedInterface[];
    extractEnums?(root: SgNode, fp: string): ExtractedEnum[];
}
```

### Engine (dispatcher)

```typescript
// src/parser/extractors/engine.ts

const EXTRACTORS: Record<string, LanguageExtractors> = {
    typescript: tsExtractors,
    javascript: tsExtractors,
    python: pyExtractors,
    ruby: rbExtractors,
    go: goExtractors,
    java: javaExtractors,
    kotlin: ktExtractors,
    rust: rsExtractors,
    csharp: csExtractors,
    php: phpExtractors,
    swift: swiftExtractors,
    dart: dartExtractors,
    scala: scalaExtractors,
    c: cExtractors,
    cpp: cppExtractors,
    elixir: exExtractors,
};

export function extractAll(
    root: SgRoot,
    fp: string,
    lang: string,
    graph: RawGraph,
): void {
    const spec = EXTRACTORS[lang];
    if (!spec) {
        log.warn('No extractor for language', { lang, file: fp });
        return;
    }

    const rootNode = root.root();

    // Classes
    for (const c of spec.extractClasses(rootNode, fp)) {
        const qualified = c.className
            ? `${fp}::${c.className}.${c.name}`
            : `${fp}::${c.name}`;
        graph.classes.push({
            ...c,
            file: fp,
            qualified,
        });
    }

    // Functions (includes methods, constructors, tests)
    for (const f of spec.extractFunctions(rootNode, fp)) {
        const qualified = f.className
            ? `${fp}::${f.className}.${f.name}`
            : `${fp}::${f.name}`;

        if (f.isTest) {
            graph.tests.push({
                name: f.name,
                file: fp,
                line_start: f.line_start,
                line_end: f.line_end,
                ast_kind: f.ast_kind,
                qualified,
                content_hash: f.content_hash,
            });
        }

        graph.functions.push({
            ...f,
            file: fp,
            qualified,
        });
    }

    // Imports
    for (const i of spec.extractImports(rootNode, fp)) {
        graph.imports.push({ ...i, file: fp });
    }

    // Interfaces (optional)
    if (spec.extractInterfaces) {
        for (const i of spec.extractInterfaces(rootNode, fp)) {
            graph.interfaces.push({
                ...i,
                file: fp,
                qualified: `${fp}::${i.name}`,
            });
        }
    }

    // Enums (optional)
    if (spec.extractEnums) {
        for (const e of spec.extractEnums(rootNode, fp)) {
            graph.enums.push({
                ...e,
                file: fp,
                qualified: `${fp}::${e.name}`,
            });
        }
    }
}
```

### Shared helpers

```typescript
// src/parser/extractors/shared.ts

// Reusable across all languages
export function computeContentHash(text: string): string;
export function extractModifiers(node: SgNode): string;
export function findAncestorByKinds(node: SgNode, kinds: string[]): SgNode | null;
export function extractDecorators(node: SgNode, kinds: string[]): string[];
export function extractThrowStatements(node: SgNode, kinds: string[]): string[];
export function isAsyncByKeyword(node: SgNode): boolean;
export function isExportedByModifier(node: SgNode, exportKeywords: string[]): boolean;
export function nodeRange(node: SgNode): { line_start: number; line_end: number };
```

---

## Novos campos no GraphNode

### Tipo atualizado

```typescript
export interface GraphNode {
    // Existing
    kind: NodeKind;
    ast_kind?: string;
    name: string;
    qualified_name: string;
    file_path: string;
    line_start: number;
    line_end: number;
    language: string;
    parent_name?: string;
    params?: string;
    return_type?: string;
    modifiers?: string;
    is_test: boolean;
    file_hash?: string;
    content_hash?: string;

    // NEW
    is_exported?: boolean;
    is_async?: boolean;
    decorators?: string[];
    throws?: string[];
}
```

### Semântica por linguagem

**is_exported:**

| Linguagem | Regra |
|-----------|-------|
| TS/JS | `export` keyword ou `export default` |
| Python | Nome não começa com `_` (convenção) |
| Go | Nome começa com maiúscula |
| Java/Kotlin/C# | `public` modifier |
| Rust | `pub` ou `pub(crate)` modifier |
| PHP | Tudo é público por default; `private`/`protected` = NOT exported |
| Ruby | Tudo público por default; `private`/`protected` methods = NOT exported |
| Swift | `public`, `open` modifiers |
| Dart | Nome não começa com `_` |
| Scala | Tudo público por default; `private`/`protected` = NOT exported |
| C/C++ | `extern` ou definido em header |
| Elixir | `def` = exported, `defp` = private |

**is_async:**

| Linguagem | Regra |
|-----------|-------|
| TS/JS | `async` keyword |
| Python | `async def` |
| Rust | `async fn` |
| C# | `async` modifier |
| Dart | `async` keyword, `Future` return type |
| Swift | `async` keyword |
| Java/Kotlin | `false` (concurrency via threads/coroutines, não keyword) |
| Go | `false` (goroutines, não keyword) |
| Ruby/PHP | `false` |
| Elixir | `false` (concurrency via processes, não keyword) |
| C/C++ | `false` |
| Scala | `false` |

**decorators:**

| Linguagem | AST node kind |
|-----------|---------------|
| TS/JS | `decorator` |
| Python | buscar em `decorated_definition` parent |
| Java/Kotlin | `marker_annotation`, `annotation` |
| C# | `attribute_list` children |
| Rust | `attribute_item` |
| Swift | `attribute` |
| Dart | `annotation` (metadata) |
| Go/Ruby/PHP/C/Scala/Elixir | Sem decorators no AST — `[]` |

**throws:**

| Linguagem | Como extrair |
|-----------|-------------|
| Java/Kotlin | `throws` clause na assinatura |
| TS/JS | `throw_statement` nodes no body |
| Python | `raise_statement` nodes no body |
| C# | `throw_statement` nodes no body |
| Go | Retorno com `error` type (heurístico) |
| Rust | `Result<>` return type (heurístico) |
| Swift | `throws` keyword na assinatura |
| Dart | Sem throws clause — `[]` |
| Ruby | `raise` calls no body |
| PHP | `throw_expression` no body |
| C++ | `throw` specifier (deprecated) — `[]` |
| Elixir | `raise`/`throw` no body |

---

## Impacto no blast radius

### is_exported

O BFS do blast-radius atualmente segue todos os CALLS edges sem distinção. Com `is_exported`:

- Se uma função **private/non-exported** muda → blast radius fica contido ao arquivo (callers são locais)
- Se uma função **exported** muda → blast radius propaga normalmente pra outros arquivos
- Callers de uma função non-exported que apontam de outro arquivo → edge com confidence rebaixada (provavelmente resolução errada)

### is_async

Contract diff: se `is_async` muda de `false` pra `true` (ou vice-versa), é uma breaking change:
- sync → async: todos os callers precisam adicionar `await`
- async → sync: todos os callers podem remover `await` (mas pode quebrar se dependiam de Promise)

Adicionar ao `ContractDiff`:
```typescript
export interface ContractDiff {
    field: 'params' | 'return_type' | 'modifiers' | 'is_async';
    old_value: string;
    new_value: string;
}
```

### decorators

Se `@Injectable()` muda pra `@Singleton()`, ou é removido — afeta o DI container inteiro. Contract diff para decorators:
```typescript
{ field: 'decorators', old_value: '@Injectable()', new_value: '@Singleton()' }
```

### throws

Se uma função que antes não throwava passa a throwar `NotFoundException` — callers que não fazem try/catch vão crashar. O `caller_impact` message:
```
Impact: 3 callers may need error handling for NotFoundException
```

---

## Estrutura de arquivos final

```
src/parser/extractors/
    spec.ts             — interface LanguageExtractors + Extracted* types
    engine.ts           — dispatch + Raw* conversion
    shared.ts           — helpers reusáveis
    typescript.ts       — TS/JS (~150 linhas)
    python.ts           — Python (~100 linhas)
    ruby.ts             — Ruby (~100 linhas)
    go.ts               — Go (~120 linhas)
    java.ts             — Java (~120 linhas)
    kotlin.ts           — Kotlin (~120 linhas)
    rust.ts             — Rust (~130 linhas)
    csharp.ts           — C# (~100 linhas)
    php.ts              — PHP (~100 linhas)
    swift.ts            — Swift (~120 linhas)
    dart.ts             — Dart (~120 linhas)
    scala.ts            — Scala (~100 linhas)
    c.ts                — C/C++ (~130 linhas)
    elixir.ts           — Elixir (~100 linhas)
```

**generic.ts é deletado.** Cada linguagem é autocontida.

---

## Novas linguagens

### Swift

- **Lang pack:** `@ast-grep/lang-swift`
- **Resolver:** Novo — `import Module` resolve via Swift Package Manager (`Package.swift`)
- **Especificidades:** `public`/`open`/`internal` access, `async` keyword, `@objc`/`@available` attributes, `throws` keyword, protocols (interfaces)

### Dart

- **Lang pack:** `@ast-grep/lang-dart`
- **Resolver:** Novo — `import 'package:name/path.dart'` resolve via `pubspec.yaml`
- **Especificidades:** `_` prefix = private, `async`/`await`, `@override`/`@protected` annotations, `abstract class`, mixins

### Scala

- **Lang pack:** `@ast-grep/lang-scala`
- **Resolver:** Reusar Java (JVM, `build.sbt`/`build.gradle`)
- **Especificidades:** `trait` = interface, `object` = singleton, `case class`, `implicit`/`given`, `extends` + `with` (mix traits)

### C/C++

- **Lang pack:** `@ast-grep/lang-c` + `@ast-grep/lang-cpp`
- **Resolver:** Novo — `#include "file.h"` resolve relativo, `#include <lib>` = system
- **Especificidades:** Headers vs source files, `extern`, preprocessor macros, namespaces (C++), templates (C++), sem async/decorators

### Elixir

- **Lang pack:** `@ast-grep/lang-elixir`
- **Resolver:** Novo — `mix.exs` deps, module-based `alias`/`import`/`use`
- **Especificidades:** `def` = public, `defp` = private, `defmodule`, `@spec`/`@doc` attributes, pattern matching, GenServer callbacks

---

## Novas linguagens — Resolvers

| Linguagem | Config de deps | Import syntax | External detection |
|-----------|---------------|---------------|-------------------|
| **Swift** | `Package.swift` | `import Module` | SPM deps |
| **Dart** | `pubspec.yaml` | `import 'package:x/y.dart'` | pub deps |
| **Scala** | `build.sbt` / `build.gradle` | `import com.example.Foo` | Maven/Gradle (reusa Java) |
| **C/C++** | `CMakeLists.txt` / `Makefile` | `#include "file.h"` / `#include <lib>` | System includes |
| **Elixir** | `mix.exs` | `alias MyApp.Module` / `import Module` | Hex deps |

---

## Fases de implementação

### Fase 1: Refactor extractors

1. Criar `spec.ts` com interfaces
2. Criar `shared.ts` com helpers
3. Criar `engine.ts` com dispatcher
4. Migrar cada linguagem existente (TS, Python, Ruby, Go, Java, Kotlin, Rust, C#, PHP) do generic.ts pra seu próprio arquivo
5. Deletar `generic.ts`
6. Todos os 528 testes devem continuar passando

### Fase 2: Novos campos

1. Adicionar `is_exported`, `is_async`, `decorators`, `throws` aos tipos (`Extracted*`, `Raw*`, `GraphNode`)
2. Implementar helpers em `shared.ts`
3. Adicionar extração em cada linguagem
4. Atualizar `builder.ts` pra propagar novos campos
5. Atualizar `diff.ts` pra detectar mudanças em `is_async` e `decorators` como contract diffs
6. Atualizar `enrich.ts` pra incluir throws no caller_impact
7. Atualizar `prompt-formatter.ts` pra mostrar novos campos
8. Testes pra cada campo em cada linguagem

### Fase 3: Novas linguagens

1. Swift (extractor + resolver + tests)
2. Dart (extractor + resolver + tests)
3. Scala (extractor + resolver reusa Java + tests)
4. C/C++ (extractor + resolver + tests)
5. Elixir (extractor + resolver + tests)

Cada linguagem validada contra um repo real.

---

## O que NAO muda

- **call-resolver.ts** — a lógica de resolução de calls (5-tier cascade) não muda
- **import-resolver.ts** — o dispatcher de resolvers não muda
- **blast-radius.ts** — a lógica BFS não muda (já function-level com confidence filter)
- **context-builder.ts** — não muda
- **graph JSON schema** — backward compatible (novos campos são opcionais)
- **CLI interface** — nenhuma mudança nos comandos

## Resultado esperado

- **generic.ts deletado** — substituído por 9 arquivos de ~100-150 linhas cada
- **14 linguagens** suportadas (9 existentes + 5 novas)
- **4 novos campos** no graph (is_exported, is_async, decorators, throws)
- **Blast radius mais preciso** — para em boundaries de exported/private
- **Contract diffs mais ricos** — detecta async changes, decorator changes, throws changes
- **Adicionar linguagem nova = 1 arquivo de ~100 linhas**
