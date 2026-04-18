import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../graph/types';

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

export interface ExtractionResult {
    classes: ExtractedClass[];
    functions: ExtractedFunction[];
    imports: ExtractedImport[];
    reExports: ExtractedReExport[];
    interfaces: ExtractedInterface[];
    enums: ExtractedEnum[];
    diEntries: ExtractedDI[];
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
}
