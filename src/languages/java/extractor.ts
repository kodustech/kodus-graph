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
} from '../shared';
import type { ExtractionResult, LanguageExtractors } from '../spec';

// Branch kinds for Java cyclomatic complexity.
// `else if` is a nested `if_statement` in the alternative — `if_statement`
// alone suffices. `switch_label` is the case-level kind (skip the outer
// `switch_expression` / `switch_block`). Java has both classic `for_statement`
// and `enhanced_for_statement` (for-each) — both are decisions.
const JAVA_BRANCH_KINDS = [
    'if_statement',
    'for_statement',
    'enhanced_for_statement',
    'while_statement',
    'do_statement',
    'switch_label',
    'catch_clause',
    'ternary_expression',
] as const;

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function extractImportModule(node: SgNode): string {
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'string' || ck === 'interpreted_string_literal' || ck === 'string_fragment') {
            const raw = child.text();
            return raw.replace(/^["'`]|["'`]$/g, '');
        }
        for (const grandchild of child.children()) {
            const gck = grandchild.kind();
            if (gck === 'string_fragment' || gck === 'string_content') {
                return grandchild.text();
            }
        }
    }

    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'scoped_identifier' || ck === 'scoped_type_identifier' || ck === 'qualified_name') {
            return child.text();
        }
    }

    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'name' || ck === 'namespace_name' || ck === 'use_tree') {
            return child.text();
        }
    }

    for (const child of node.children()) {
        if (child.kind() === 'identifier' || child.kind() === 'type_identifier') {
            return child.text();
        }
    }

    return node
        .text()
        .replace(/^\s*(import|use|using|require)\s+/i, '')
        .replace(/[;{}]/g, '')
        .trim();
}

function extractImportNames(node: SgNode): string[] {
    const names: string[] = [];
    for (const child of node.children()) {
        const ck = child.kind();
        if (ck === 'identifier' || ck === 'type_identifier' || ck === 'name') {
            names.push(child.text());
        }
    }
    return names;
}

// ---------------------------------------------------------------------------
// Heritage helpers
// ---------------------------------------------------------------------------

function javaExtends(node: SgNode): string | undefined {
    const superclass = node.children().find((c: SgNode) => c.kind() === 'superclass');
    if (!superclass) {
        return undefined;
    }
    const typeId = superclass.children().find((c: SgNode) => c.kind() === 'type_identifier');
    return typeId?.text();
}

function javaImplements(node: SgNode): string[] {
    const superInterfaces = node.children().find((c: SgNode) => c.kind() === 'super_interfaces');
    if (!superInterfaces) {
        return [];
    }
    const typeList = superInterfaces.children().find((c: SgNode) => c.kind() === 'type_list');
    const container = typeList || superInterfaces;
    return container
        .children()
        .filter((c: SgNode) => c.kind() === 'type_identifier')
        .map((c: SgNode) => c.text());
}

// ---------------------------------------------------------------------------
// Test detection config
// ---------------------------------------------------------------------------

const ANNOTATION_KIND = 'marker_annotation';
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
        if (k !== 'marker_annotation' && k !== 'annotation') {
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
const JAVA_CLASS_DECL_KINDS = new Set(['class_declaration', 'record_declaration']);

function findEnclosingJavaClass(node: SgNode): SgNode | null {
    return node.ancestors().find((a) => JAVA_CLASS_DECL_KINDS.has(String(a.kind()))) ?? null;
}

function countJavaConstructors(classNode: SgNode): number {
    const body = classNode.field('body');
    if (!body) {
        return 0;
    }
    let n = 0;
    for (const c of body.children()) {
        if (c.kind() === 'constructor_declaration') {
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
        for (const node of root.findAll({ rule: { kind: 'class_declaration' } })) {
            const name = node.field('name')?.text();
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
                decorators: extractDecorators(node, ['marker_annotation', 'annotation']),
            });
        }

        // ── Interfaces ──────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'interface_declaration' } })) {
            const name = node.field('name')?.text();
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
        for (const node of root.findAll({ rule: { kind: 'enum_declaration' } })) {
            const name = node.field('name')?.text();
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
        const funcKinds = ['method_declaration', 'constructor_declaration'];
        const constructorKindSet = new Set(['constructor_declaration']);
        const methodKindSet = new Set(['method_declaration']);

        for (const funcKind of funcKinds) {
            for (const node of root.findAll({ rule: { kind: funcKind } })) {
                const name = node.field('name')?.text();
                if (!name) {
                    continue;
                }

                let className = '';
                const classAncestor = node.ancestors().find((a: SgNode) => {
                    const k = String(a.kind());
                    return k.includes('class') || k.includes('struct') || k.includes('impl');
                });
                if (classAncestor) {
                    className = classAncestor.field('name')?.text() || '';
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
                const throwsClause = node.children().find((c) => String(c.kind()) === 'throws');
                if (throwsClause) {
                    for (const child of throwsClause.children()) {
                        if (String(child.kind()) === 'type_identifier') {
                            javaThrows.push(child.text());
                        }
                    }
                }

                result.functions.push({
                    name,
                    line_start: range.line_start,
                    line_end: range.line_end,
                    params: node.field('parameters')?.text() || '()',
                    returnType: node.field('return_type')?.text() || '',
                    kind,
                    ast_kind: String(node.kind()),
                    className,
                    modifiers: funcModifiers,
                    content_hash: computeContentHash(node.text()),
                    isTest,
                    is_exported: isExported(name, node, { modifierKeywords: ['public'] }),
                    is_async: false,
                    decorators: extractDecorators(node, ['marker_annotation', 'annotation']),
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
        for (const fd of root.findAll({ rule: { kind: 'field_declaration' } })) {
            const typeNode = fd.children().find((c) => {
                const k = c.kind();
                return k === 'type_identifier' || k === 'generic_type' || k === 'scoped_type_identifier';
            });
            if (!typeNode) {
                continue;
            }
            const typeName =
                typeNode.kind() === 'generic_type'
                    ? typeNode
                          .children()
                          .find((c) => c.kind() === 'type_identifier')
                          ?.text() || typeNode.text()
                    : typeNode.text();
            for (const vd of fd.children()) {
                if (vd.kind() !== 'variable_declarator') {
                    continue;
                }
                const ident =
                    vd.field('name')?.text() ??
                    vd
                        .children()
                        .find((c) => c.kind() === 'identifier')
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
        for (const cd of root.findAll({ rule: { kind: 'constructor_declaration' } })) {
            const mods = cd.children().find((c) => c.kind() === 'modifiers');
            const explicitDI = hasJavaDIAnnotation(mods);
            let implicitSpringDI = false;
            if (!explicitDI) {
                const enclosing = findEnclosingJavaClass(cd);
                if (enclosing) {
                    const classMods = enclosing.children().find((c) => c.kind() === 'modifiers');
                    if (hasJavaStereotypeAnnotation(classMods) && countJavaConstructors(enclosing) === 1) {
                        implicitSpringDI = true;
                    }
                }
            }
            if (!explicitDI && !implicitSpringDI) {
                continue;
            }
            const params = cd.field('parameters');
            if (!params) {
                continue;
            }
            for (const p of params.children()) {
                if (p.kind() !== 'formal_parameter') {
                    continue;
                }
                const typeNode = p.children().find((c) => {
                    const k = c.kind();
                    return k === 'type_identifier' || k === 'generic_type' || k === 'scoped_type_identifier';
                });
                const ident =
                    p.field('name')?.text() ??
                    p
                        .children()
                        .find((c) => c.kind() === 'identifier')
                        ?.text();
                if (!typeNode || !ident) {
                    continue;
                }
                const typeName =
                    typeNode.kind() === 'generic_type'
                        ? typeNode
                              .children()
                              .find((c) => c.kind() === 'type_identifier')
                              ?.text() || typeNode.text()
                        : typeNode.text();
                result.diEntries.push({ fieldName: ident, typeName });
            }
        }

        // ── Imports ─────────────────────────────────────────────────────
        for (const node of root.findAll({ rule: { kind: 'import_declaration' } })) {
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
            const sc = classNode.children().find((c) => c.kind() === 'superclass');
            return sc
                ?.children()
                .find((c) => c.kind() === 'type_identifier')
                ?.text();
        };

        // Use declaration-kind names rather than substring checks — `class_body`
        // also contains "class" and would shadow the enclosing declaration.
        const CLASS_DECL_KINDS = new Set(['class_declaration', 'record_declaration', 'enum_declaration']);
        const findEnclosingClass = (node: SgNode): SgNode | null =>
            node.ancestors().find((a) => CLASS_DECL_KINDS.has(String(a.kind()))) ?? null;

        // Noise is NOT filtered here — the resolver applies it after the
        // receiver-type tier so user-domain calls survive to be resolved.
        for (const mi of root.findAll({ rule: { kind: 'method_invocation' } })) {
            const nameNode = mi.field('name');
            const callName = nameNode?.text();
            if (!callName) {
                continue;
            }

            const obj = mi.field('object');
            let resolveInClass: string | undefined;
            let diField: string | undefined;

            if (obj) {
                const objText = obj.text();
                const objKind = obj.kind();
                // `this.method()` — resolve against current class.
                if (objKind === 'this' || objText === 'this') {
                    const classNode = findEnclosingClass(mi);
                    resolveInClass = classNode?.field('name')?.text();
                } else if (objKind === 'super' || objText === 'super') {
                    // `super.method()` — resolve against parent class.
                    const classNode = findEnclosingClass(mi);
                    if (classNode) {
                        resolveInClass = getParentClass(classNode);
                    }
                } else if (objKind === 'field_access') {
                    // `this.field.method()` — pick up `field` so the resolver
                    // can route through diMap to the injected concrete type.
                    const accessChildren = obj.children();
                    const base = accessChildren[0];
                    const fieldName = obj.field('field')?.text();
                    if (base && fieldName && (base.kind() === 'this' || base.text() === 'this')) {
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
            if (obj?.kind() === 'method_invocation') {
                const innerName = obj.field('name');
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
    for (const lvd of root.findAll({ rule: { kind: 'local_variable_declaration' } })) {
        const declaredType = lvd.field('type')?.text();
        for (const vd of lvd.children()) {
            if (vd.kind() !== 'variable_declarator') {
                continue;
            }
            const name = vd.field('name')?.text();
            if (!name) {
                continue;
            }
            let typeName: string | undefined;
            if (declaredType && declaredType !== 'var') {
                typeName = declaredType;
            } else {
                const value = vd.field('value');
                if (value?.kind() === 'object_creation_expression') {
                    typeName = value.field('type')?.text();
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
        if (p.kind() !== 'formal_parameter') {
            return;
        }
        const typeNode = p.children().find((c) => {
            const k = c.kind();
            return k === 'type_identifier' || k === 'generic_type' || k === 'scoped_type_identifier';
        });
        const name = p.field('name')?.text();
        if (!typeNode || !name) {
            return;
        }
        const typeName =
            typeNode.kind() === 'generic_type'
                ? (typeNode
                      .children()
                      .find((c) => c.kind() === 'type_identifier')
                      ?.text() ?? typeNode.text())
                : typeNode.text();
        bindings.set(name, typeName);
    };
    for (const kind of ['constructor_declaration', 'method_declaration']) {
        for (const fn of root.findAll({ rule: { kind } })) {
            const params = fn.field('parameters');
            if (!params) {
                continue;
            }
            for (const p of params.children()) {
                seedJavaParam(p);
            }
        }
    }
    for (const mi of root.findAll({ rule: { kind: 'method_invocation' } })) {
        const obj = mi.field('object');
        if (!obj || obj.kind() !== 'identifier') {
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
        const nameNode = mi.field('name');
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
