import type { SgNode } from '@ast-grep/napi';
import type { RawCallSite } from '../../graph/types';
import { registerCapabilities } from '../capabilities';
import { computeCyclomatic } from '../complexity';
import { registerDIHeuristics, registerExtractor, registerReceiverTypes } from '../engine';
import { locationKey, type ReceiverTypeMap } from '../receiver-types';
import {
    computeContentHash,
    emptyResult,
    extractDecorators,
    extractModifiers,
    hasTestAnnotation,
    isExported,
    nodeRange,
    stripImportKeyword,
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';
import { JAVA_FIELDS, JAVA_KINDS } from './kinds';

// Branch kinds for Java cyclomatic complexity.
const JAVA_BRANCH_KINDS = [
    JAVA_KINDS.IF_STATEMENT,
    JAVA_KINDS.FOR_STATEMENT,
    JAVA_KINDS.ENHANCED_FOR_STATEMENT,
    JAVA_KINDS.WHILE_STATEMENT,
    JAVA_KINDS.DO_STATEMENT,
    JAVA_KINDS.SWITCH_LABEL,
    JAVA_KINDS.CATCH_CLAUSE,
    JAVA_KINDS.TERNARY_EXPRESSION,
] as const;

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

// A Java `import_declaration`'s only named children are `scoped_identifier`
// (e.g. `java.util.List`, `java.util.*` minus the wildcard), `identifier` (a
// single-segment import), and `asterisk`. The qualified path is the
// scoped_identifier / identifier; that's all we need.
function extractImportModule(node: SgNode): string {
    for (const child of node.children()) {
        if (child.kind() === JAVA_KINDS.SCOPED_IDENTIFIER) {
            return child.text();
        }
    }

    for (const child of node.children()) {
        if (child.kind() === JAVA_KINDS.IDENTIFIER) {
            return child.text();
        }
    }

    return stripImportKeyword(node);
}

function extractImportNames(node: SgNode): string[] {
    const names: string[] = [];
    for (const child of node.children()) {
        if (child.kind() === JAVA_KINDS.IDENTIFIER) {
            names.push(child.text());
        }
    }
    return names;
}

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function javaExtends(node: SgNode): string | undefined {
    const superclass = node.children().find((c: SgNode) => c.kind() === JAVA_KINDS.SUPERCLASS);
    if (!superclass) {
        return undefined;
    }
    const typeId = superclass.children().find((c: SgNode) => c.kind() === JAVA_KINDS.TYPE_IDENTIFIER);
    return typeId?.text();
}

function javaImplements(node: SgNode): string[] {
    const superInterfaces = node.children().find((c: SgNode) => c.kind() === JAVA_KINDS.SUPER_INTERFACES);
    if (!superInterfaces) {
        return [];
    }
    const typeList = superInterfaces.children().find((c: SgNode) => c.kind() === JAVA_KINDS.TYPE_LIST);
    const container = typeList || superInterfaces;
    return container
        .children()
        .filter((c: SgNode) => c.kind() === JAVA_KINDS.TYPE_IDENTIFIER)
        .map((c: SgNode) => c.text());
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const ANNOTATION_KIND = JAVA_KINDS.MARKER_ANNOTATION;
const ANNOTATION_NAMES = ['Test', 'ParameterizedTest'];

// ---------------------------------------------------------------------------
// DI annotation helpers
// ---------------------------------------------------------------------------

// Last-segment names of recognized DI annotations (covers `@Inject`,
// `@javax.inject.Inject`, `@jakarta.inject.Inject`, `@Autowired`,
// `@org.springframework.beans.factory.annotation.Autowired`, `@Resource`).
const DI_ANNOTATION_NAMES = new Set(['Inject', 'Autowired', 'Resource']);

// Class-level annotations that mark a Java type as a managed bean. Each of
// these triggers implicit ctor injection (single-ctor + class annotation =
// auto-inject params) following the Spring 4.3+ pattern. Covers Spring,
// Jakarta CDI, EJB, JAX-RS, Quarkus, MicroProfile, and Java EE.
const JAVA_DI_STEREOTYPE_NAMES = new Set([
    // Spring
    'Service',
    'Component',
    'Repository',
    'Controller',
    'RestController',
    'Configuration',
    // CDI / Jakarta EE
    'ApplicationScoped',
    'RequestScoped',
    'SessionScoped',
    'ConversationScoped',
    'Dependent',
    'Singleton',
    // EJB
    'Stateless',
    'Stateful',
    'MessageDriven',
    // JAX-RS
    'Path',
    'Provider',
]);

function annotationLastSegment(c: SgNode): string {
    const head = c.text().split('(')[0].trim().replace(/^@/, '');
    return head.split('.').pop() ?? '';
}

function hasJavaAnnotationFrom(modifiersNode: SgNode | undefined, names: ReadonlySet<string>): boolean {
    if (!modifiersNode) {
        return false;
    }
    for (const c of modifiersNode.children()) {
        const k = c.kind();
        if (k !== JAVA_KINDS.MARKER_ANNOTATION && k !== JAVA_KINDS.ANNOTATION) {
            continue;
        }
        if (names.has(annotationLastSegment(c))) {
            return true;
        }
    }
    return false;
}

function hasJavaDIAnnotation(modifiersNode: SgNode | undefined): boolean {
    return hasJavaAnnotationFrom(modifiersNode, DI_ANNOTATION_NAMES);
}

function hasJavaStereotypeAnnotation(modifiersNode: SgNode | undefined): boolean {
    return hasJavaAnnotationFrom(modifiersNode, JAVA_DI_STEREOTYPE_NAMES);
}

// Class declaration kinds that can host @Service / @Component etc.
// `record_declaration` lets Java records (Java 14+) act as Spring beans too.
const JAVA_CLASS_DECL_KINDS = new Set<string>([JAVA_KINDS.CLASS_DECLARATION, JAVA_KINDS.RECORD_DECLARATION]);

function findEnclosingJavaClass(node: SgNode): SgNode | null {
    return node.ancestors().find((a) => JAVA_CLASS_DECL_KINDS.has(String(a.kind()))) ?? null;
}

function countJavaConstructors(classNode: SgNode): number {
    const body = classNode.field(JAVA_FIELDS.BODY);
    if (!body) {
        return 0;
    }
    let n = 0;
    for (const c of body.children()) {
        if (c.kind() === JAVA_KINDS.CONSTRUCTOR_DECLARATION) {
            n++;
        }
    }
    return n;
}

// ---------------------------------------------------------------------------
// Java extractor
// ---------------------------------------------------------------------------

export const javaExtractors: LanguageExtractors = {
    extract(root: SgNode, _fp: string): ExtractionResult {
        const result = emptyResult();

        // ── Classes ──────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: JAVA_KINDS.CLASS_DECLARATION } })) {
            const name = node.field(JAVA_FIELDS.NAME)?.text();
            if (!name) {
                continue;
            }

            let extendsVal = '';
            const raw = javaExtends(node);
            if (typeof raw === 'string') {
                extendsVal = raw;
            }

            let implementsVal: string[] = [];
            const rawImpl = javaImplements(node);
            if (Array.isArray(rawImpl)) {
                implementsVal = rawImpl;
            }

            const classModifiers = extractModifiers(node);
            const range = nodeRange(node);

            result.classes.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                extends: extendsVal,
                implements: implementsVal,
                ast_kind: String(node.kind()),
                modifiers: classModifiers,
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
                decorators: extractDecorators(node, [JAVA_KINDS.MARKER_ANNOTATION, JAVA_KINDS.ANNOTATION]),
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: JAVA_KINDS.INTERFACE_DECLARATION } })) {
            const name = node.field(JAVA_FIELDS.NAME)?.text();
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.interfaces.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                methods: [],
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
            });
        }

        // ── Enums ───────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: JAVA_KINDS.ENUM_DECLARATION } })) {
            const name = node.field(JAVA_FIELDS.NAME)?.text();
            if (!name) {
                continue;
            }

            const range = nodeRange(node);
            result.enums.push({
                name,
                line_start: range.line_start,
                line_end: range.line_end,
                ast_kind: String(node.kind()),
                content_hash: computeContentHash(node.text()),
                is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
            });
        }

        // ── Functions / Methods / Constructors ──────────────────────────
        const funcKinds = [JAVA_KINDS.METHOD_DECLARATION, JAVA_KINDS.CONSTRUCTOR_DECLARATION];
        const constructorKindSet = new Set<string>([JAVA_KINDS.CONSTRUCTOR_DECLARATION]);
        const methodKindSet = new Set<string>([JAVA_KINDS.METHOD_DECLARATION]);

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field(JAVA_FIELDS.NAME)?.text();
                if (!name) {
                    continue;
                }

                let className = '';
                // Match class_declaration exactly — `includes('class')` would
                // also match `class_body`, which has no `name` field, leaving
                // className empty even when the method is clearly inside a class.
                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return (
                        k === JAVA_KINDS.CLASS_DECLARATION ||
                        k === JAVA_KINDS.RECORD_DECLARATION ||
                        k === JAVA_KINDS.INTERFACE_DECLARATION
                    );
                });
                if (classAncestor) {
                    className = classAncestor.field(JAVA_FIELDS.NAME)?.text() || '';
                }

                let kind: 'Function' | 'Method' | 'Constructor';
                if (constructorKindSet.has(funcKind)) {
                    kind = 'Constructor';
                } else if (methodKindSet.has(funcKind) || className) {
                    kind = 'Method';
                } else {
                    kind = 'Function';
                }

                // Test detection
                const isTest = hasTestAnnotation(node, ANNOTATION_KIND, ANNOTATION_NAMES);

                const funcModifiers = extractModifiers(node);
                const range = nodeRange(node);

                // Java throws clause: find `throws` child and extract type names
                const javaThrows: string[] = [];
                const throwsClause = node.children().find((c) => String(c.kind()) === JAVA_KINDS.THROWS);
                if (throwsClause) {
                    for (const child of throwsClause.children()) {
                        if (String(child.kind()) === JAVA_KINDS.TYPE_IDENTIFIER) {
                            javaThrows.push(child.text());
                        }
                    }
                }

                // Java tree-sitter exposes the return type as `type` field, not
                // `return_type`. Constructors don't have a return type.
                const returnTypeText = constructorKindSet.has(funcKind)
                    ? ''
                    : node.field(JAVA_FIELDS.TYPE)?.text() || '';
                result.functions.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    params: node.field(JAVA_FIELDS.PARAMETERS)?.text() || '()',
                    returnType: returnTypeText,
                    kind,
                    ast_kind: String(node.kind()),
                    className,
                    modifiers: funcModifiers,
                    content_hash: computeContentHash(node.text()),
                    isTest,
                    is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
                    is_async: false,
                    decorators: extractDecorators(node, [JAVA_KINDS.MARKER_ANNOTATION, JAVA_KINDS.ANNOTATION]),
                    throws: javaThrows,
                    complexity: computeCyclomatic(node, JAVA_BRANCH_KINDS),
                });
            }
        }

        // ── DI: typed fields and annotated constructors ─────────────────
        // Field injection: ALL typed reference fields become diMap entries.
        // Annotated (`@Inject`/`@Autowired`/`@Resource`) fields are the explicit
        // signal; for all others we still extract the field's declared type so
        // `this.field.method()` resolves at the receiver tier.
        //
        // Rationale (added 2026-04-30 for Quarkus/CDI/EJB codebases like
        // keycloak): real-world Java DI patterns frequently DON'T use
        // annotations — Lombok `@RequiredArgsConstructor` injects all final
        // fields without explicit `@Inject`, manual ctor injection sets bare
        // `private final Foo foo;`, and CDI's @Inject often goes on the ctor
        // rather than the fields. Extracting all typed-field declarations
        // catches these patterns at the cost of also indexing non-DI fields —
        // which is harmless because the resolver only consults diMap when the
        // call is `this.field.method()`.
        for (const fd of root.findAll({ rule: { kind: JAVA_KINDS.FIELD_DECLARATION } })) {
            const typeNode = fd.children().find((c) => {
                const k = c.kind();
                return (
                    k === JAVA_KINDS.TYPE_IDENTIFIER ||
                    k === JAVA_KINDS.GENERIC_TYPE ||
                    k === JAVA_KINDS.SCOPED_TYPE_IDENTIFIER
                );
            });
            if (!typeNode) {
                continue;
            }
            const typeName =
                typeNode.kind() === JAVA_KINDS.GENERIC_TYPE
                    ? typeNode
                          .children()
                          .find((c) => c.kind() === JAVA_KINDS.TYPE_IDENTIFIER)
                          ?.text() || typeNode.text()
                    : typeNode.text();
            for (const vd of fd.children()) {
                if (vd.kind() !== JAVA_KINDS.VARIABLE_DECLARATOR) {
                    continue;
                }
                const ident =
                    vd.field(JAVA_FIELDS.NAME)?.text() ??
                    vd
                        .children()
                        .find((c) => c.kind() === JAVA_KINDS.IDENTIFIER)
                        ?.text();
                if (ident) {
                    result.diEntries.push({ fieldName: ident, typeName });
                }
            }
        }

        // Constructor injection: `@Inject` (or `@Autowired`) on the constructor
        // marks each parameter as a DI binding (param name → param type).
        // Spring 4.3+ also auto-injects when the enclosing class has a stereotype
        // annotation (@Service / @Component / @Repository / @Controller /
        // @RestController / @Configuration) AND exactly one constructor.
        for (const cd of root.findAll({ rule: { kind: JAVA_KINDS.CONSTRUCTOR_DECLARATION } })) {
            const mods = cd.children().find((c) => c.kind() === JAVA_KINDS.MODIFIERS);
            const explicitDI = hasJavaDIAnnotation(mods);
            let implicitSpringDI = false;
            if (!explicitDI) {
                const enclosing = findEnclosingJavaClass(cd);
                if (enclosing) {
                    const classMods = enclosing.children().find((c) => c.kind() === JAVA_KINDS.MODIFIERS);
                    if (hasJavaStereotypeAnnotation(classMods) && countJavaConstructors(enclosing) === 1) {
                        implicitSpringDI = true;
                    }
                }
            }
            if (!explicitDI && !implicitSpringDI) {
                continue;
            }
            const params = cd.field(JAVA_FIELDS.PARAMETERS);
            if (!params) {
                continue;
            }
            for (const p of params.children()) {
                if (p.kind() !== JAVA_KINDS.FORMAL_PARAMETER) {
                    continue;
                }
                const typeNode = p.children().find((c) => {
                    const k = c.kind();
                    return (
                        k === JAVA_KINDS.TYPE_IDENTIFIER ||
                        k === JAVA_KINDS.GENERIC_TYPE ||
                        k === JAVA_KINDS.SCOPED_TYPE_IDENTIFIER
                    );
                });
                const ident =
                    p.field(JAVA_FIELDS.NAME)?.text() ??
                    p
                        .children()
                        .find((c) => c.kind() === JAVA_KINDS.IDENTIFIER)
                        ?.text();
                if (!typeNode || !ident) {
                    continue;
                }
                const typeName =
                    typeNode.kind() === JAVA_KINDS.GENERIC_TYPE
                        ? typeNode
                              .children()
                              .find((c) => c.kind() === JAVA_KINDS.TYPE_IDENTIFIER)
                              ?.text() || typeNode.text()
                        : typeNode.text();
                result.diEntries.push({ fieldName: ident, typeName });
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: JAVA_KINDS.IMPORT_DECLARATION } })) {
            const module = extractImportModule(node);
            if (!module) {
                continue;
            }
            result.imports.push({
                module,
                line: node.range().start.line,
                names: extractImportNames(node),
                lang: 'java',
            });
        }

        return result;
    },

    extractCalls(root: SgNode, fp: string, calls: RawCallSite[]): void {
        // Java needs a walk-based extraction rather than the shared
        // `$CALLEE($$$ARGS)` pattern: that pattern only binds to bare
        // `foo(args)` invocations in the tree-sitter-java grammar and drops
        // member calls like `x.method(args)` on the floor (the grammar puts
        // those under a distinct `method_invocation` shape with separate
        // `object` / `name` fields that the pattern parser can't unify).
        // Walking `method_invocation` directly captures both uniformly.

        const getParentClass = (classNode: SgNode): string | undefined => {
            const sc = classNode.children().find((c) => c.kind() === JAVA_KINDS.SUPERCLASS);
            return sc
                ?.children()
                .find((c) => c.kind() === JAVA_KINDS.TYPE_IDENTIFIER)
                ?.text();
        };

        // Use declaration-kind names rather than substring checks — `class_body`
        // also contains "class" and would shadow the enclosing declaration.
        const CLASS_DECL_KINDS = new Set<string>([
            JAVA_KINDS.CLASS_DECLARATION,
            JAVA_KINDS.RECORD_DECLARATION,
            JAVA_KINDS.ENUM_DECLARATION,
        ]);
        const findEnclosingClass = (node: SgNode): SgNode | null =>
            node.ancestors().find((a) => CLASS_DECL_KINDS.has(String(a.kind()))) ?? null;

        // Noise is NOT filtered here — the resolver applies it after the
        // receiver-type tier so user-domain calls survive to be resolved.
        for (const mi of root.findAll({ rule: { kind: JAVA_KINDS.METHOD_INVOCATION } })) {
            const nameNode = mi.field(JAVA_FIELDS.NAME);
            const callName = nameNode?.text();
            if (!callName) {
                continue;
            }

            const obj = mi.field(JAVA_FIELDS.OBJECT);
            let resolveInClass: string | undefined;
            let diField: string | undefined;

            if (obj) {
                const objText = obj.text();
                const objKind = obj.kind();
                // `this.method()` — resolve against current class.
                if (objKind === JAVA_KINDS.THIS || objText === 'this') {
                    const classNode = findEnclosingClass(mi);
                    resolveInClass = classNode?.field(JAVA_FIELDS.NAME)?.text();
                } else if (objKind === JAVA_KINDS.SUPER || objText === 'super') {
                    // `super.method()` — resolve against parent class.
                    const classNode = findEnclosingClass(mi);
                    if (classNode) {
                        resolveInClass = getParentClass(classNode);
                    }
                } else if (objKind === JAVA_KINDS.FIELD_ACCESS) {
                    // `this.field.method()` — pick up `field` so the resolver
                    // can route through diMap to the injected concrete type.
                    const accessChildren = obj.children();
                    const base = accessChildren[0];
                    const fieldName = obj.field(JAVA_FIELDS.FIELD)?.text();
                    if (base && fieldName && (base.kind() === JAVA_KINDS.THIS || base.text() === 'this')) {
                        diField = fieldName;
                    }
                }
                // For other `x.method()` member calls, `callName` alone is
                // enough — the receiver-type inference pass cross-references
                // by file/line/column to surface `receiverType`.
            }

            // Column = end of method name (≈ col of `(`). Matches receiver-
            // type extractor and the shared call extractor convention so
            // chained calls don't collide on receiver-type lookup.
            const r = (nameNode ?? mi).range().end;

            // Chain detection: `obj.find().greet()` — the outer mi's object
            // is the inner method_invocation. Record the inner's column so
            // the resolver's second pass can propagate its return type as
            // the outer's receiverType.
            let chainedFromLine: number | undefined;
            let chainedFromColumn: number | undefined;
            if (obj?.kind() === JAVA_KINDS.METHOD_INVOCATION) {
                const innerName = obj.field(JAVA_FIELDS.NAME);
                const innerR = (innerName ?? obj).range().end;
                chainedFromLine = innerR.line;
                chainedFromColumn = innerR.column;
            }

            calls.push({
                source: fp,
                callName,
                line: r.line,
                column: r.column,
                ...(resolveInClass ? { resolveInClass } : {}),
                ...(diField ? { diField } : {}),
                ...(chainedFromLine !== undefined ? { chainedFromLine, chainedFromColumn } : {}),
            });
        }
    },
};

// Receiver-type inference: `Foo x = new Foo()` (explicit type), `var x = new Foo()` (Java 10+).
function extractReceiverTypesJava(root: SgNode, fp: string): ReceiverTypeMap {
    const out: ReceiverTypeMap = new Map();
    const bindings = new Map<string, string>();
    for (const lvd of root.findAll({ rule: { kind: JAVA_KINDS.LOCAL_VARIABLE_DECLARATION } })) {
        const declaredType = lvd.field(JAVA_FIELDS.TYPE)?.text();
        for (const vd of lvd.children()) {
            if (vd.kind() !== JAVA_KINDS.VARIABLE_DECLARATOR) {
                continue;
            }
            const name = vd.field(JAVA_FIELDS.NAME)?.text();
            if (!name) {
                continue;
            }
            let typeName: string | undefined;
            if (declaredType && declaredType !== 'var') {
                typeName = declaredType;
            } else {
                const value = vd.field(JAVA_FIELDS.VALUE);
                if (value?.kind() === JAVA_KINDS.OBJECT_CREATION_EXPRESSION) {
                    typeName = value.field(JAVA_FIELDS.TYPE)?.text();
                }
                // Java 10+ `var x = factory();` — emit a deferred `@CALLEE:`
                // marker so the resolver substitutes the callee's return type
                // cross-file. Mirrors the TS/Python/Kotlin path. Only fires
                // when the LHS is actually `var` (declaredType === 'var') and
                // the RHS is a method invocation with a simple identifier callee.
                if (!typeName && declaredType === 'var' && value?.kind() === JAVA_KINDS.METHOD_INVOCATION) {
                    const fnNameNode = value.field(JAVA_FIELDS.NAME);
                    const fnObj = value.field(JAVA_FIELDS.OBJECT);
                    // Only bare `factory()` calls (no receiver) — `obj.method()`
                    // would need a different resolution strategy.
                    if (fnNameNode && !fnObj) {
                        typeName = `@CALLEE:${fnNameNode.text()}`;
                    }
                }
            }
            if (typeName) {
                bindings.set(name, typeName);
            }
        }
    }
    // Constructor and method parameters become scope-local bindings —
    // `repo.findAll()` inside the body resolves through the receiver tier (0.95)
    // instead of falling through to DI (0.9) or cascade. Covers both
    // constructors and regular methods (extended 2026-04-30).
    const seedJavaParam = (p: SgNode): void => {
        if (p.kind() !== JAVA_KINDS.FORMAL_PARAMETER) {
            return;
        }
        const typeNode = p.children().find((c) => {
            const k = c.kind();
            return (
                k === JAVA_KINDS.TYPE_IDENTIFIER ||
                k === JAVA_KINDS.GENERIC_TYPE ||
                k === JAVA_KINDS.SCOPED_TYPE_IDENTIFIER
            );
        });
        const name = p.field(JAVA_FIELDS.NAME)?.text();
        if (!typeNode || !name) {
            return;
        }
        const typeName =
            typeNode.kind() === JAVA_KINDS.GENERIC_TYPE
                ? (typeNode
                      .children()
                      .find((c) => c.kind() === JAVA_KINDS.TYPE_IDENTIFIER)
                      ?.text() ?? typeNode.text())
                : typeNode.text();
        bindings.set(name, typeName);
    };
    for (const kind of [JAVA_KINDS.CONSTRUCTOR_DECLARATION, JAVA_KINDS.METHOD_DECLARATION]) {
        for (const fn of root.findAll({ rule: { kind } })) {
            const params = fn.field(JAVA_FIELDS.PARAMETERS);
            if (!params) {
                continue;
            }
            for (const p of params.children()) {
                seedJavaParam(p);
            }
        }
    }
    for (const mi of root.findAll({ rule: { kind: JAVA_KINDS.METHOD_INVOCATION } })) {
        const obj = mi.field(JAVA_FIELDS.OBJECT);
        if (!obj || obj.kind() !== JAVA_KINDS.IDENTIFIER) {
            continue;
        }
        const objText = obj.text();
        let typeName = bindings.get(objText);
        // Static method call heuristic: PascalCase receiver = class reference.
        // `Logger.getLogger(...)` → receiverType='Logger'.
        if (!typeName && /^[A-Z][A-Za-z0-9_]*$/.test(objText)) {
            typeName = objText;
        }
        if (!typeName) {
            continue;
        }
        // Column = end of method name (≈ col of `(` of args).
        const nameNode = mi.field(JAVA_FIELDS.NAME);
        const r = (nameNode ?? mi).range().end;
        out.set(locationKey(fp, r.line, r.column), typeName);
    }
    return out;
}

registerExtractor('java', javaExtractors);
registerReceiverTypes('java', extractReceiverTypesJava);

// Capabilities: CompletableFuture/async (framework-level), annotations,
// checked+unchecked exceptions, static types, nominal interfaces.
registerCapabilities('java', {
    hasAsync: true,
    hasDecorators: true,
    hasExceptions: true,
    hasStaticTypes: true,
    interfaceKind: 'nominal',
});

// DI heuristic: bare interface `UserService` → `UserServiceImpl` or
// `DefaultUserService` (dominant Spring/JEE community conventions).
function javaDiHeuristics(typeName: string): string[] {
    return [`${typeName}Impl`, `Default${typeName}`];
}

registerDIHeuristics('java', javaDiHeuristics);
