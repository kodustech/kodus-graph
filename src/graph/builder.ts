import { deriveEdges } from './edges';
import type { GraphData, GraphEdge, GraphNode, ImportEdge, RawCallEdge, RawGraph } from './types';

export function buildGraphData(
    raw: RawGraph,
    callEdges: RawCallEdge[],
    importEdges: ImportEdge[],
    _repoDir: string,
    fileHashes: Map<string, string>,
): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Functions -> nodes
    for (const f of raw.functions) {
        nodes.push({
            kind: f.kind,
            ast_kind: f.ast_kind,
            name: f.name,
            qualified_name: f.qualified,
            file_path: f.file,
            line_start: f.line_start,
            line_end: f.line_end,
            language: detectLang(f.file),
            parent_name: f.className || undefined,
            params: f.params || undefined,
            return_type: f.returnType || undefined,
            is_test: false,
            file_hash: fileHashes.get(f.file) || '',
            content_hash: f.content_hash,
        });
    }

    // Classes -> nodes
    for (const c of raw.classes) {
        nodes.push({
            kind: 'Class',
            ast_kind: c.ast_kind,
            name: c.name,
            qualified_name: c.qualified,
            file_path: c.file,
            line_start: c.line_start,
            line_end: c.line_end,
            language: detectLang(c.file),
            is_test: false,
            file_hash: fileHashes.get(c.file) || '',
            content_hash: c.content_hash,
        });
    }

    // Interfaces -> nodes
    for (const i of raw.interfaces) {
        nodes.push({
            kind: 'Interface',
            ast_kind: i.ast_kind,
            name: i.name,
            qualified_name: i.qualified,
            file_path: i.file,
            line_start: i.line_start,
            line_end: i.line_end,
            language: detectLang(i.file),
            is_test: false,
            file_hash: fileHashes.get(i.file) || '',
            content_hash: i.content_hash,
        });
    }

    // Enums -> nodes
    for (const e of raw.enums) {
        nodes.push({
            kind: 'Enum',
            ast_kind: e.ast_kind,
            name: e.name,
            qualified_name: e.qualified,
            file_path: e.file,
            line_start: e.line_start,
            line_end: e.line_end,
            language: detectLang(e.file),
            is_test: false,
            file_hash: fileHashes.get(e.file) || '',
            content_hash: e.content_hash,
        });
    }

    // Tests -> nodes
    for (const t of raw.tests) {
        nodes.push({
            kind: 'Test',
            ast_kind: t.ast_kind,
            name: t.name,
            qualified_name: t.qualified,
            file_path: t.file,
            line_start: t.line_start,
            line_end: t.line_end,
            language: detectLang(t.file),
            is_test: true,
            file_hash: fileHashes.get(t.file) || '',
            content_hash: t.content_hash,
        });
    }

    // Build a set of all parsed file paths for validation (filter external targets)
    const parsedFiles = new Set<string>();
    for (const f of raw.functions) parsedFiles.add(f.file);
    for (const c of raw.classes) parsedFiles.add(c.file);
    for (const i of raw.interfaces) parsedFiles.add(i.file);
    for (const e of raw.enums) parsedFiles.add(e.file);
    for (const t of raw.tests) parsedFiles.add(t.file);

    // Build file→functions index to resolve caller from line number
    const functionsByFile = new Map<string, Array<{ qualified_name: string; line_start: number; line_end: number }>>();
    for (const node of nodes) {
        if (node.kind === 'Class' || node.kind === 'Interface' || node.kind === 'Enum') {
            continue;
        }
        const entry = { qualified_name: node.qualified_name, line_start: node.line_start, line_end: node.line_end };
        const list = functionsByFile.get(node.file_path);
        if (list) {
            list.push(entry);
        } else {
            functionsByFile.set(node.file_path, [entry]);
        }
    }
    // Sort descending by line_start so inner/nested functions match first
    for (const list of functionsByFile.values()) {
        list.sort((a, b) => b.line_start - a.line_start);
    }

    // CALLS edges — resolve caller function from call line number
    for (const ce of callEdges) {
        // Skip calls to external packages (target file not in repo)
        const targetFile = ce.target.split('::')[0];
        if (targetFile && !parsedFiles.has(targetFile)) {
            continue;
        }

        const sourceFile = ce.source.includes('::') ? ce.source.split('::')[0] : ce.source;
        let sourceQualified: string;

        if (ce.source.includes('::')) {
            sourceQualified = ce.source;
        } else {
            // Find the innermost function containing this call line
            const fns = functionsByFile.get(ce.source);
            let resolved: string | undefined;
            if (fns) {
                for (const fn of fns) {
                    if (ce.line >= fn.line_start && ce.line <= fn.line_end) {
                        resolved = fn.qualified_name;
                        break;
                    }
                }
            }
            sourceQualified = resolved || `${ce.source}::unknown`;
        }

        edges.push({
            kind: 'CALLS',
            source_qualified: sourceQualified,
            target_qualified: ce.target,
            file_path: sourceFile,
            line: ce.line,
            confidence: ce.confidence,
        });
    }

    // IMPORTS edges — only emit resolved imports (skip external/unresolved packages)
    for (const ie of importEdges) {
        if (!ie.resolved) {
            continue;
        }
        edges.push({
            kind: 'IMPORTS',
            source_qualified: ie.source,
            target_qualified: ie.target,
            file_path: ie.source,
            line: ie.line,
        });
    }

    // Derived edges
    const derived = deriveEdges(raw, importEdges);

    for (const e of derived.inherits) {
        edges.push({
            kind: 'INHERITS',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.file || '',
            line: 0,
        });
    }
    for (const e of derived.implements) {
        edges.push({
            kind: 'IMPLEMENTS',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.file || '',
            line: 0,
        });
    }
    for (const e of derived.testedBy) {
        edges.push({
            kind: 'TESTED_BY',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.target || '',
            line: 0,
        });
    }
    for (const e of derived.contains) {
        edges.push({
            kind: 'CONTAINS',
            source_qualified: e.source,
            target_qualified: e.target,
            file_path: e.source,
            line: 0,
        });
    }

    return { nodes, edges };
}

function detectLang(file: string): string {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        return 'typescript';
    }
    if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
        return 'javascript';
    }
    if (file.endsWith('.py')) {
        return 'python';
    }
    if (file.endsWith('.rb')) {
        return 'ruby';
    }
    if (file.endsWith('.go')) {
        return 'go';
    }
    if (file.endsWith('.java')) {
        return 'java';
    }
    if (file.endsWith('.rs')) {
        return 'rust';
    }
    if (file.endsWith('.cs')) {
        return 'csharp';
    }
    if (file.endsWith('.php')) {
        return 'php';
    }
    return 'unknown';
}
