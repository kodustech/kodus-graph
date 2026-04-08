# Resolver Test Fixtures & Improvements Design

## Context

kodus-graph is a CLI that runs in a sandbox with the user's cloned repository. It builds a code knowledge graph (nodes, edges, call resolution) using ast-grep for AST parsing and language-specific import resolvers to connect cross-file references.

The current import resolvers work but have blind spots: no tsconfig extends chain, no Python relative imports, no Go replace directives, no Java wildcard imports, no Rust workspace support, etc. These gaps produce incorrect or missing edges in the graph, which degrades code review quality.

## Goal

1. Create exhaustive test fixtures representing every real-world import pattern across 8 languages
2. Write tests that assert correct resolution for each pattern
3. Use failing tests to drive resolver improvements (test-first)
4. Ensure the code graph is correct — wrong data is worse than missing data

## Constraints

- **Filesystem only** — the CLI has access to the cloned repo, nothing installed (no node_modules, no pip packages, no go toolchain)
- **No external dependencies** — resolvers use only config files (tsconfig.json, go.mod, Cargo.toml, etc.) + filesystem probing
- **Performance matters** — repos can be large; cache config parsing, minimize filesystem probing
- **Quality over coverage** — a wrong edge is worse than a missing edge

## Architecture: Config-Aware Resolver Layer

Before resolving imports, a **project config loader** runs once per repo and pre-parses all relevant config files. Resolvers receive this pre-parsed config instead of re-reading files per import.

```
[1] Project Config Loader (once per repo)
    -> tsconfig.json (with extends chain fully resolved)
    -> go.mod (with replace directives)
    -> go.work (workspace modules)
    -> Cargo.toml (workspace members, path deps)
    -> pyproject.toml / setup.cfg (package roots, src layout)
    -> pom.xml / build.gradle / settings.gradle (source roots, multi-module)
    -> composer.json (PSR-4 mappings)
    -> *.csproj / *.sln (ProjectReference)
    -> Gemfile (path gems)

[2] Resolvers receive config + shared filesystem cache
    -> Each resolver uses what it needs
    -> existsSync() calls cached across resolvers

[3] Import resolution returns confidence metadata
    -> "resolved via config" (high) vs "resolved via probing" (medium) vs "unresolved" (null)
```

---

## Test Fixtures Catalog

### Structure

```
tests/
  fixtures/
    typescript/
      basic/
      tsconfig-paths/
      tsconfig-rootdirs/
      barrel-exports/
      monorepo/
      package-imports/
      framework-aliases/
    python/
      basic/
      src-layout/
      namespace-package/
      django/
      wildcard-and-all/
    go/
      basic/
      replace/
      workspace/
      cgo/
    java/
      basic/
      wildcard-and-inner/
      multi-module/
      kotlin-interop/
    rust/
      basic/
      workspace/
      reexports/
      mod-patterns/
    php/
      psr4/
      laravel/
      group-use/
    csharp/
      basic/
      multi-project/
      global-usings/
    ruby/
      basic/
      rails/
      gemfile-path/
  resolver/
    typescript.test.ts
    python.test.ts
    go.test.ts
    java.test.ts
    rust.test.ts
    php.test.ts
    csharp.test.ts
    ruby.test.ts
```

Each fixture is a minimal but realistic project structure with real files, real config files, and real import statements. Tests call the resolver and assert the resolved path.

---

## TypeScript/JavaScript (7 fixtures, ~25 tests)

### 1. `typescript/basic/`

**Tests:** relative imports, extension probing (.ts/.tsx/.js/.jsx), index files, ESM .js->.ts remap

```
src/
  app.ts              -> import { helper } from './utils/helper'
  utils/
    helper.ts         -> export function helper() {}
    index.ts          -> export { helper } from './helper'
  services/
    auth.ts           -> import { helper } from '../utils'
    user.ts           -> import { auth } from './auth.js'
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Relative with subpath | `./utils/helper` from `app.ts` | `src/utils/helper.ts` |
| Index file resolution | `../utils` from `auth.ts` | `src/utils/index.ts` |
| ESM .js->.ts remap | `./auth.js` from `user.ts` | `src/services/auth.ts` |
| Extension probing order | `./helper` from `utils/index.ts` | `src/utils/helper.ts` |

### 2. `typescript/tsconfig-paths/`

**Tests:** path aliases, baseUrl, extends chain inheritance

```
tsconfig.json         -> { "extends": "./tsconfig.base.json",
                           "compilerOptions": { "paths": { "@app/*": ["src/*"] } } }
tsconfig.base.json    -> { "compilerOptions": { "baseUrl": ".",
                           "paths": { "@shared/*": ["libs/shared/src/*"] } } }
src/
  app.ts              -> import { DB } from '@app/db'
  db.ts
libs/
  shared/
    src/
      utils.ts
app2.ts               -> import { format } from '@shared/utils'
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Direct path alias | `@app/db` from `app.ts` | `src/db.ts` |
| Inherited alias from extends | `@shared/utils` from `app2.ts` | `libs/shared/src/utils.ts` |
| Extends chain is followed | — | Aliases from base are merged with child |
| Multi-target alias (first match wins) | Alias with 2+ targets | First existing match |

### 3. `typescript/tsconfig-rootdirs/`

**Tests:** rootDirs virtual directory merge

```
tsconfig.json         -> { "compilerOptions": { "rootDirs": ["src", "generated"] } }
src/
  app.ts              -> import { Schema } from './schema'
generated/
  schema.ts           -> export interface Schema {}
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Cross-rootDir resolution | `./schema` from `src/app.ts` | `generated/schema.ts` |
| Same rootDir (normal) | `./app` from `src/other.ts` | `src/app.ts` |

### 4. `typescript/barrel-exports/`

**Tests:** re-exports, `export * from`, nested barrels

```
src/
  index.ts            -> export { UserService } from './services/user'
                         export * from './models'
  services/
    user.ts           -> export class UserService {}
    auth.ts           -> export class AuthService {}
  models/
    index.ts          -> export { User } from './user'
    user.ts           -> export class User {}
  app.ts              -> import { UserService } from '.'
                         import { User } from './models'
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Named re-export | `UserService` from `.` in `app.ts` | Traces to `services/user.ts` |
| Nested barrel | `User` from `./models` in `app.ts` | Traces to `models/user.ts` |
| `export * from` | `*` from `./models` in `index.ts` | All exports from `models/index.ts` |

### 5. `typescript/monorepo/`

**Tests:** workspace packages, package.json exports field, workspace:* protocol

```
package.json          -> { "workspaces": ["packages/*"] }
packages/
  ui/
    package.json      -> { "name": "@acme/ui",
                           "exports": { ".": "./src/index.ts",
                                        "./button": "./src/components/button.ts" } }
    src/
      index.ts        -> export { Button } from './components/button'
      components/
        button.ts     -> export function Button() {}
  app/
    package.json      -> { "dependencies": { "@acme/ui": "workspace:*" } }
    src/
      page.ts         -> import { Button } from '@acme/ui'
      form.ts         -> import { Button } from '@acme/ui/button'
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Workspace root export | `@acme/ui` from `page.ts` | `packages/ui/src/index.ts` |
| Workspace subpath export | `@acme/ui/button` from `form.ts` | `packages/ui/src/components/button.ts` |
| Workspace discovery | — | Reads root `package.json` workspaces + child `package.json` names |

### 6. `typescript/package-imports/`

**Tests:** `#imports` field (self-referencing package imports)

```
package.json          -> { "imports": { "#db/*": "./src/db/*.ts",
                                        "#utils": "./src/shared/utils.ts" } }
src/
  app.ts              -> import { connect } from '#db/connection'
                         import { format } from '#utils'
  db/
    connection.ts     -> export function connect() {}
  shared/
    utils.ts          -> export function format() {}
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Wildcard # import | `#db/connection` from `app.ts` | `src/db/connection.ts` |
| Exact # import | `#utils` from `app.ts` | `src/shared/utils.ts` |

### 7. `typescript/framework-aliases/`

**Tests:** SvelteKit `$lib`, Next.js `@/`, Vite `?suffix`

```
tsconfig.json         -> { "compilerOptions": { "paths": {
                           "$lib/*": ["src/lib/*"],
                           "@/*": ["./src/*"] } } }
src/
  lib/
    auth.ts
  components/
    form.ts
  routes/
    page.ts           -> import { login } from '$lib/auth'
                         import { Form } from '@/components/form'
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| SvelteKit $lib alias | `$lib/auth` | `src/lib/auth.ts` |
| Next.js @/ alias | `@/components/form` | `src/components/form.ts` |
| Vite ?raw suffix strip | `./file.txt?raw` | `./file.txt` (strip query) |

---

## Python (5 fixtures, ~15 tests)

### 1. `python/basic/`

**Tests:** absolute imports, relative imports (., .., ...), `__init__.py` re-exports

```
mypackage/
  __init__.py          -> from .models.user import User
  models/
    __init__.py        -> from .user import User
    user.py            -> class User: pass
  services/
    __init__.py
    auth.py            -> from ..models.user import User
                          from ..models import User
    billing.py         -> from . import auth
  utils/
    __init__.py
    helpers.py         -> from mypackage.models.user import User
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Relative parent `..` | `..models.user` from `auth.py` | `mypackage/models/user.py` |
| Relative parent `__init__` | `..models` from `auth.py` | `mypackage/models/__init__.py` |
| Relative current `.` | `. import auth` from `billing.py` | `mypackage/services/auth.py` |
| Absolute dotted path | `mypackage.models.user` from `helpers.py` | `mypackage/models/user.py` |
| Re-export via `__init__` | `mypackage import User` | Traces to `mypackage/models/user.py` |

### 2. `python/src-layout/`

**Tests:** src layout with pyproject.toml Poetry/Hatch config

```
pyproject.toml         -> [tool.poetry]
                          packages = [{include = "myapp", from = "src"}]
src/
  myapp/
    __init__.py
    core/
      __init__.py
      engine.py        -> class Engine: pass
    api/
      __init__.py
      routes.py        -> from myapp.core.engine import Engine
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Absolute with src remapping | `myapp.core.engine` from `routes.py` | `src/myapp/core/engine.py` |
| Config-driven root detection | — | Reads pyproject.toml `from = "src"` |

### 3. `python/namespace-package/`

**Tests:** PEP 420 namespace packages (no `__init__.py` at top level)

```
mycompany/              (NO __init__.py)
  auth/
    __init__.py
    service.py         -> class AuthService: pass
  billing/
    __init__.py
    service.py         -> class BillingService: pass
app.py                 -> from mycompany.auth.service import AuthService
                          from mycompany.billing.service import BillingService
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Namespace package (no __init__) | `mycompany.auth.service` | `mycompany/auth/service.py` |
| Cross-namespace sibling | `mycompany.billing.service` | `mycompany/billing/service.py` |

### 4. `python/django/`

**Tests:** Django app-relative imports

```
manage.py
myproject/
  __init__.py
  settings.py
  urls.py              -> from users.views import UserListView
users/
  __init__.py
  models.py            -> class User: pass
  views.py             -> from .models import User
                          from orders.models import Order
orders/
  __init__.py
  models.py            -> class Order: pass
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| App-level relative | `.models` from `views.py` | `users/models.py` |
| Cross-app absolute | `orders.models` from `views.py` | `orders/models.py` |
| Top-level app import | `users.views` from `urls.py` | `users/views.py` |

### 5. `python/wildcard-and-all/`

**Tests:** `from module import *` controlled by `__all__`

```
mylib/
  __init__.py          -> __all__ = ['Foo', 'Bar']
                          from .foo import Foo
                          from .bar import Bar
                          from .internal import _Secret
  foo.py               -> class Foo: pass
  bar.py               -> class Bar: pass
  internal.py          -> class _Secret: pass
app.py                 -> from mylib import *
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Wildcard with __all__ | `from mylib import *` | Resolves Foo -> foo.py, Bar -> bar.py |
| Excluded from __all__ | _Secret | NOT exposed via wildcard |

---

## Go (4 fixtures, ~10 tests)

### 1. `go/basic/`

**Tests:** module-relative imports, stdlib detection, multi-file package

```
go.mod                 -> module github.com/acme/myapp
cmd/
  main.go              -> import "github.com/acme/myapp/internal/auth"
                          import "fmt"
internal/
  auth/
    handler.go         -> package auth
    middleware.go       -> package auth
pkg/
  utils/
    strings.go         -> package utils
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Module-relative | `github.com/acme/myapp/internal/auth` | `internal/auth/` (first .go) |
| Stdlib | `fmt` | null (no dot in first segment) |
| Nested package | `github.com/acme/myapp/pkg/utils` | `pkg/utils/` |

### 2. `go/replace/`

**Tests:** go.mod replace directives (local path)

```
go.mod                 -> module github.com/acme/app
                          require github.com/acme/shared v0.0.0
                          replace github.com/acme/shared => ./libs/shared
libs/
  shared/
    go.mod             -> module github.com/acme/shared
    utils/
      helper.go        -> package utils
main.go                -> import "github.com/acme/shared/utils"
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Replace local path | `github.com/acme/shared/utils` | `libs/shared/utils/` |
| Replace module root | `github.com/acme/shared` | `libs/shared/` |

### 3. `go/workspace/`

**Tests:** go.work multi-module

```
go.work                -> use (./api, ./libs/common)
api/
  go.mod               -> module github.com/acme/api
                          require github.com/acme/common v0.0.0
  main.go              -> import "github.com/acme/common/logger"
libs/
  common/
    go.mod             -> module github.com/acme/common
    logger/
      logger.go        -> package logger
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Workspace cross-module | `github.com/acme/common/logger` | `libs/common/logger/` |
| Workspace discovery | — | Reads go.work `use` directives |

### 4. `go/cgo/`

**Tests:** CGo sentinel

```
go.mod                 -> module github.com/acme/native
main.go                -> import "C"
                          import "github.com/acme/native/wrapper"
wrapper/
  bridge.go            -> package wrapper
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| CGo sentinel | `"C"` | null (not a Go package) |
| Normal alongside CGo | module-relative | Resolves normally |

---

## Java (4 fixtures, ~12 tests)

### 1. `java/basic/`

**Tests:** explicit imports, Maven source root convention

```
src/main/java/
  com/example/
    App.java           -> import com.example.service.UserService;
    service/
      UserService.java -> package com.example.service;
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Standard FQCN | `com.example.service.UserService` | `src/main/java/com/example/service/UserService.java` |
| Stdlib filter | `java.util.List` | null |

### 2. `java/wildcard-and-inner/`

**Tests:** wildcard imports, inner classes, static imports

```
src/main/java/
  com/example/
    App.java           -> import com.example.models.*;
                          import com.example.Config.DatabaseSettings;
                          import static com.example.Constants.MAX_RETRIES;
    models/
      User.java
      Order.java
    Config.java        -> public class Config {
                            public static class DatabaseSettings {}
                          }
    Constants.java     -> public class Constants {
                            public static int MAX_RETRIES = 3;
                          }
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Wildcard | `com.example.models.*` | Directory `models/` -> lists User.java, Order.java |
| Inner class | `com.example.Config.DatabaseSettings` | `Config.java` |
| Static import | `static com.example.Constants.MAX_RETRIES` | `Constants.java` |

### 3. `java/multi-module/`

**Tests:** Gradle multi-project

```
settings.gradle        -> include ':app', ':lib'
app/
  build.gradle         -> dependencies { implementation project(':lib') }
  src/main/java/
    com/example/app/
      Main.java        -> import com.example.lib.SharedUtil;
lib/
  build.gradle
  src/main/java/
    com/example/lib/
      SharedUtil.java
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Cross-module import | `com.example.lib.SharedUtil` | `lib/src/main/java/com/example/lib/SharedUtil.java` |
| Module discovery | — | Reads settings.gradle `include` directives |

### 4. `java/kotlin-interop/`

**Tests:** Java importing Kotlin

```
src/main/java/
  com/example/
    App.java           -> import com.example.KotlinHelper;
src/main/kotlin/
  com/example/
    KotlinHelper.kt
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Java -> Kotlin | `com.example.KotlinHelper` | `src/main/kotlin/com/example/KotlinHelper.kt` |
| Source root probing | — | Tries `src/main/java` then `src/main/kotlin` |

---

## Rust (4 fixtures, ~12 tests)

### 1. `rust/basic/`

**Tests:** crate::, self::, super::, mod file conventions, bin+lib

```
Cargo.toml             -> [package] name = "myapp"
src/
  lib.rs               -> mod models; mod services; pub use models::User;
  main.rs              -> use myapp::User;
  models/
    mod.rs             -> pub mod user; pub use user::User;
    user.rs            -> pub struct User {}
  services/
    mod.rs             -> mod auth;
    auth.rs            -> use crate::models::User;
                          use super::*;
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| crate:: absolute | `crate::models::User` from `auth.rs` | `src/models/user.rs` |
| super:: relative | `super::*` from `auth.rs` | `src/services/mod.rs` |
| bin imports lib | `myapp::User` from `main.rs` | `src/lib.rs` -> `models/user.rs` |
| mod.rs convention | `mod models` in `lib.rs` | `src/models/mod.rs` |

### 2. `rust/workspace/`

**Tests:** Cargo workspace with path deps

```
Cargo.toml             -> [workspace] members = ["crates/*"]
crates/
  app/
    Cargo.toml         -> [dependencies] shared = { path = "../shared" }
    src/
      main.rs          -> use shared::helper::format;
  shared/
    Cargo.toml         -> [package] name = "shared"
    src/
      lib.rs           -> pub mod helper;
      helper.rs        -> pub fn format() {}
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Workspace path dep | `shared::helper::format` | `crates/shared/src/helper.rs` |
| Workspace discovery | — | Reads root Cargo.toml members + crate Cargo.toml path deps |

### 3. `rust/reexports/`

**Tests:** `pub use` re-exports

```
Cargo.toml             -> [package] name = "myapp"
src/
  lib.rs               -> pub mod internal;
                          pub use internal::core::Engine;
  internal/
    mod.rs             -> pub mod core;
    core.rs            -> pub struct Engine {}
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| pub use re-export | `myapp::Engine` | Traces through `lib.rs` pub use -> `internal/core.rs` |

### 4. `rust/mod-patterns/`

**Tests:** foo.rs vs foo/mod.rs

```
Cargo.toml             -> edition = "2021"
src/
  lib.rs               -> mod alpha; mod beta;
  alpha.rs             -> pub fn a() {}
  beta/
    mod.rs             -> pub fn b() {}
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| File-based module | `mod alpha` | `src/alpha.rs` |
| Directory-based module | `mod beta` | `src/beta/mod.rs` |

---

## PHP (3 fixtures, ~8 tests)

### 1. `php/psr4/`

**Tests:** PSR-4 with multiple namespace roots

```
composer.json          -> { "autoload": { "psr-4": {
                            "App\\": "src/",
                            "Tests\\": "tests/" } } }
src/
  Models/
    User.php           -> namespace App\Models;
  Http/
    Controllers/
      UserController.php -> namespace App\Http\Controllers;
                            use App\Models\User;
tests/
  UserTest.php         -> namespace Tests;
                          use App\Models\User;
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| PSR-4 namespace | `App\Models\User` | `src/Models/User.php` |
| Second PSR-4 root | `Tests\UserTest` | `tests/UserTest.php` |
| Cross-root reference | `App\Models\User` from tests | `src/Models/User.php` |

### 2. `php/laravel/`

**Tests:** Laravel `app/` convention

```
composer.json          -> { "autoload": { "psr-4": { "App\\": "app/" } } }
app/
  Models/
    User.php
  Services/
    AuthService.php    -> use App\Models\User;
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Laravel app convention | `App\Models\User` | `app/Models/User.php` |

### 3. `php/group-use/`

**Tests:** Group use declarations

```
composer.json          -> PSR-4 mapping
src/
  App.php              -> use App\Models\{User, Post, Comment};
  Models/
    User.php
    Post.php
    Comment.php
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Group use - each symbol | `App\Models\User` | `src/Models/User.php` |
| Group use - each symbol | `App\Models\Post` | `src/Models/Post.php` |

---

## C# (3 fixtures, ~8 tests)

### 1. `csharp/basic/`

**Tests:** namespace using, source directory probing

```
src/
  Models/
    User.cs            -> namespace MyApp.Models; public class User {}
  Services/
    AuthService.cs     -> using MyApp.Models;
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Namespace using | `MyApp.Models` from `AuthService.cs` | `src/Models/` directory |
| Stdlib filter | `System.Collections.Generic` | null |

### 2. `csharp/multi-project/`

**Tests:** ProjectReference in .csproj

```
MyApp.sln
src/
  MyApp/
    MyApp.csproj       -> <ProjectReference Include="../Shared/Shared.csproj" />
    Program.cs         -> using Shared.Utils;
  Shared/
    Shared.csproj
    Utils/
      Helper.cs        -> namespace Shared.Utils;
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Cross-project using | `Shared.Utils` from `Program.cs` | `src/Shared/Utils/` |
| ProjectReference discovery | — | Reads .csproj for ProjectReference paths |

### 3. `csharp/global-usings/`

**Tests:** global using, implicit usings

```
MyApp.csproj           -> <ImplicitUsings>enable</ImplicitUsings>
GlobalUsings.cs        -> global using MyApp.Models;
src/
  Models/
    User.cs            -> namespace MyApp.Models; public class User {}
  Services/
    Auth.cs            -> namespace MyApp.Services;
                          public class Auth { User u; }
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Global using | `MyApp.Models` available in `Auth.cs` | via `GlobalUsings.cs` |
| Implicit usings detection | — | Reads .csproj ImplicitUsings flag |

---

## Ruby (3 fixtures, ~8 tests)

### 1. `ruby/basic/`

**Tests:** require_relative

```
lib/
  app.rb               -> require_relative 'models/user'
  models/
    user.rb            -> class User; end
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| require_relative subpath | `models/user` from `app.rb` | `lib/models/user.rb` |

### 2. `ruby/rails/`

**Tests:** Zeitwerk autoload conventions

```
config/
  application.rb
app/
  models/
    user.rb            -> class User; end
  services/
    auth_service.rb    -> class AuthService; end
  controllers/
    admin/
      users_controller.rb -> class Admin::UsersController; end
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Zeitwerk class -> file | `User` | `app/models/user.rb` |
| Zeitwerk nested namespace | `Admin::UsersController` | `app/controllers/admin/users_controller.rb` |
| Zeitwerk snake_case convention | `AuthService` | `app/services/auth_service.rb` |

### 3. `ruby/gemfile-path/`

**Tests:** Local gem via Gemfile path:

```
Gemfile                -> gem 'mylib', path: './libs/mylib'
libs/
  mylib/
    lib/
      mylib.rb         -> module MyLib; end
      mylib/
        helper.rb      -> class MyLib::Helper; end
app.rb                 -> require 'mylib'
                          require 'mylib/helper'
```

| Test | Import | Expected resolution |
|------|--------|-------------------|
| Gemfile path gem | `require 'mylib'` | `libs/mylib/lib/mylib.rb` |
| Gem subpath | `require 'mylib/helper'` | `libs/mylib/lib/mylib/helper.rb` |

---

## Summary

| Language | Fixtures | Test cases | Key patterns covered |
|----------|:--------:|:----------:|---------------------|
| TypeScript/JS | 7 | ~25 | Relative, extensions, tsconfig (paths/extends/rootDirs), barrels, monorepo workspaces, package.json exports/#imports, framework aliases |
| Python | 5 | ~15 | Absolute, relative (./../../), __init__.py re-exports, src layout, namespace packages, Django, wildcard/__all__ |
| Go | 4 | ~10 | Module-relative, stdlib, replace directives, go.work workspaces, CGo sentinel |
| Java | 4 | ~12 | FQCN, wildcard, inner classes, static imports, multi-module (Gradle), Kotlin interop |
| Rust | 4 | ~12 | crate::/self::/super::, mod.rs vs file.rs, workspace path deps, pub use re-exports, bin+lib |
| PHP | 3 | ~8 | PSR-4 (multi-root), Laravel convention, group use |
| C# | 3 | ~8 | Namespace using, ProjectReference, global usings |
| Ruby | 3 | ~8 | require_relative, Zeitwerk autoload, Gemfile path gems |
| **Total** | **33** | **~98** | |

## Patterns explicitly out of scope

These patterns cannot be resolved from filesystem alone and are excluded:

- Dynamic imports with computed paths (`import(\`./langs/${lang}\`)`)
- Runtime DI registration (Spring `@ComponentScan`, Laravel `$app->bind()`)
- Python `importlib.import_module()` with dynamic strings
- Go plugin `plugin.Open()`
- Build-time generated code (annotation processors, Rust build.rs)
- `sys.path` / `PYTHONPATH` manipulation
- GOPATH mode (legacy)
- PHP dynamic class loading (`new $class()`)

## Implementation order

1. **Create all 33 fixtures** with real files and configs
2. **Write all ~98 tests** — most will fail against current resolvers
3. **Implement config loader** — parse tsconfig extends, go.mod replace, Cargo.toml workspace, etc.
4. **Fix resolvers one language at a time** — drive by failing tests
5. **Add filesystem cache** — shared `existsSync` cache across all resolvers
6. **Validate** — all tests green, run against real repos for sanity check
