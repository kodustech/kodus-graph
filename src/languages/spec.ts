import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../graph/types';
import type { ReceiverTypeMap } from './receiver-types';

export interface ExtractedClass {
    name: string;
    line_start: number;
    line_end: number;
    extends: string;
    implements: string[];
    modifiers: string;
    ast_kind: string;
    content_hash: string;
    is_exported: boolean;
    decorators: string[];
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
    ast_kind: string;
    content_hash: string;
    isTest: boolean;
    is_exported: boolean;
    is_async: boolean;
    decorators: string[];
    throws: string[];
    /** McCabe cyclomatic complexity. 1 = straight-line code. */
    complexity: number;
}

export interface ExtractedImport {
    module: string;
    line: number;
    names: string[];
    lang: string;
}

export interface ExtractedReExport {
    module: string;
    line: number;
}

export interface ExtractedInterface {
    name: string;
    line_start: number;
    line_end: number;
    methods: string[];
    ast_kind: string;
    content_hash: string;
    is_exported: boolean;
}

export interface ExtractedEnum {
    name: string;
    line_start: number;
    line_end: number;
    ast_kind: string;
    content_hash: string;
    is_exported: boolean;
}

export interface ExtractedDI {
    fieldName: string;
    typeName: string;
}

export interface ExtractedValueBinding {
    /** Variable name as declared at module/file scope. */
    name: string;
    /**
     * Inferred type. Either a concrete class name (e.g. `Database`) or a
     * deferred marker (e.g. `@CALLEE:factory`) that the resolver expands
     * cross-file.
     */
    type: string;
}

export interface ExtractionResult {
    classes: ExtractedClass[];
    functions: ExtractedFunction[];
    imports: ExtractedImport[];
    reExports: ExtractedReExport[];
    interfaces: ExtractedInterface[];
    enums: ExtractedEnum[];
    diEntries: ExtractedDI[];
    /**
     * Module/file-scope `const x = new Foo()` style bindings. Used by the
     * resolver to substitute receiverType when a call's receiver is an
     * imported value: `import { db } from './services'; db.query()` resolves
     * because services.ts contributed `{ name: 'db', type: 'Database' }` to
     * the global value-binding map.
     *
     * Optional — only populated by extractors that walk module-scope
     * variable declarations (TS today; Python/Kotlin pending).
     */
    valueBindings?: ExtractedValueBinding[];
}

export interface LanguageExtractors {
    extract(root: SgNode, fp: string): ExtractionResult;
    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void;
    /**
     * Given a DI type name (e.g. `IUserService`, `UserService`, `Storage`),
     * return candidate implementation names the language would resolve to,
     * in preference order. Empty array when no implementations exist for
     * this specific type. Omit the property entirely when the language has
     * no naming convention at all.
     *
     * Note: this field is an optional contract marker — actual wiring uses
     * `registerDIHeuristics(key, fn)` at module-load time in each language's
     * extractor, so the resolver can discover heuristics via language key
     * without holding a reference to the extractor struct.
     */
    diHeuristics?(typeName: string): string[];

    /**
     * Optional scope-local receiver-type inference. Walks the file's AST and
     * returns a map from call-site location keys to inferred type names, e.g.
     * records `'src/a.ts:10:4' → 'Foo'` for `x.update()` where `x` was
     * declared as `const x = new Foo()`.
     *
     * Dynamic languages (Ruby, PHP, Elixir) should either omit this or
     * register a no-op returning an empty map. The parser batch wires the
     * result into `RawCallSite.receiverType` for the resolver's high-
     * confidence receiver tier.
     *
     * Actual wiring uses `registerReceiverTypes(key, fn)` at module-load
     * time in each language's extractor — the property here is an optional
     * contract marker for documentation.
     */
    extractReceiverTypes?(root: SgNode, fp: string): ReceiverTypeMap;
}
