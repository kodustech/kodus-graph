import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeParse } from '../../src/commands/parse';

// Import to trigger language registration.
import '../../src/parser/languages';

/**
 * Regression for the constructor-instantiation blast-radius gap.
 *
 * A `new X()` (or `X()` in languages where construction is a plain call)
 * previously either produced no CALLS edge at all (TS/PHP `new_expression` is
 * not matched by the generic call pattern) or landed only on the CLASS node —
 * never the CONSTRUCTOR node, whose body carries the real downstream calls.
 * So a reverse blast-radius walk from something the constructor calls stopped
 * at the constructor and never reached the instantiator. Measured on kodus-ai,
 * `runAgentLoopViaCore` (which does `new DiffCoverageLedger()`) fell out of the
 * impact set of everything the ledger's constructor transitively calls.
 *
 * The fix: extract `new X()` as a call to the class, and have the builder
 * thread a parallel CALLS edge from the caller to the class's constructor
 * node(s). This test asserts that edge exists end-to-end across the languages
 * that model it, and that it closes the reverse reachability.
 */

interface Edge {
    kind: string;
    source_qualified: string;
    target_qualified: string;
    tier?: string;
}

async function edgesFor(fileName: string, source: string): Promise<Edge[]> {
    const tmp = mkdtempSync(join(tmpdir(), 'kodus-graph-ctor-'));
    try {
        writeFileSync(join(tmp, fileName), source);
        const outPath = join(tmp, 'graph.json');
        await executeParse({ repoDir: tmp, all: true, out: outPath });
        const graph = JSON.parse(readFileSync(outPath, 'utf-8'));
        return graph.edges as Edge[];
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

function calls(edges: Edge[]): Array<[string, string]> {
    return edges.filter((e) => e.kind === 'CALLS').map((e) => [e.source_qualified, e.target_qualified]);
}

/**
 * Reverse-reachability over CALLS edges (>=0.5) — the blast-radius traversal.
 * Returns true if `from` reaches `to` walking edges backwards from `to`, i.e.
 * `to`'s change impacts `from`.
 */
function blastConnects(edges: Edge[], from: string, to: string): boolean {
    const rev = new Map<string, string[]>();
    for (const e of edges) {
        if (e.kind !== 'CALLS') {
            continue;
        }
        const list = rev.get(e.target_qualified);
        if (list) {
            list.push(e.source_qualified);
        } else {
            rev.set(e.target_qualified, [e.source_qualified]);
        }
    }
    const seen = new Set([to]);
    let frontier = [to];
    while (frontier.length) {
        const next: string[] = [];
        for (const q of frontier) {
            for (const s of rev.get(q) ?? []) {
                if (!seen.has(s)) {
                    seen.add(s);
                    next.push(s);
                }
            }
        }
        frontier = next;
    }
    return seen.has(from);
}

describe('constructor instantiation edges', () => {
    it('TS `new X()` threads the instantiator to the constructor node', async () => {
        const edges = await edgesFor(
            'svc.ts',
            [
                'export function normalizeRepoPath(p: string): string {',
                '    return p.trim();',
                '}',
                'export class Ledger {',
                '    private root: string;',
                '    constructor(p: string) {',
                '        this.root = normalizeRepoPath(p);',
                '    }',
                '}',
                'export function run(): Ledger {',
                "    return new Ledger('/x');",
                '}',
                '',
            ].join('\n'),
        );
        const c = calls(edges);
        // Constructor body call is present...
        expect(c).toContainEqual(['svc.ts::Ledger.Ledger.constructor', 'svc.ts::normalizeRepoPath']);
        // ...and the instantiator is now joined to the constructor node.
        expect(c).toContainEqual(['svc.ts::run', 'svc.ts::Ledger.Ledger.constructor']);

        // The derived instantiation edge carries no resolver tier.
        const ctorEdge = edges.find(
            (e) =>
                e.kind === 'CALLS' &&
                e.source_qualified === 'svc.ts::run' &&
                e.target_qualified === 'svc.ts::Ledger.Ledger.constructor',
        );
        expect(ctorEdge?.tier).toBeUndefined();
    });

    it('Python `X()` construction threads the instantiator to `__init__`', async () => {
        const edges = await edgesFor(
            'svc.py',
            [
                'def normalize_repo_path(p):',
                '    return p.strip()',
                'class Ledger:',
                '    def __init__(self, p):',
                '        self.root = normalize_repo_path(p)',
                'def run():',
                "    return Ledger('/x')",
                '',
            ].join('\n'),
        );
        const c = calls(edges);
        expect(c).toContainEqual(['svc.py::Ledger.__init__', 'svc.py::normalize_repo_path']);
        expect(c).toContainEqual(['svc.py::run', 'svc.py::Ledger.__init__']);
    });

    it('PHP `new X()` threads the instantiator to `__construct` (kind Method)', async () => {
        const edges = await edgesFor(
            'svc.php',
            [
                '<?php',
                'function normalize_path($p) { return trim($p); }',
                'class Ledger {',
                '    public $root;',
                '    public function __construct($p) { $this->root = normalize_path($p); }',
                '}',
                'function run() { return new Ledger("/x"); }',
                '',
            ].join('\n'),
        );
        const c = calls(edges);
        expect(c).toContainEqual(['svc.php::Ledger.__construct', 'svc.php::normalize_path']);
        expect(c).toContainEqual(['svc.php::run', 'svc.php::Ledger.__construct']);
    });

    it('keeps the class edge alongside the constructor edge (no regression to instantiation/type deps)', async () => {
        const edges = await edgesFor(
            'svc.ts',
            [
                'export class Ledger {',
                '    constructor() {}',
                '}',
                'export function run(): Ledger {',
                '    return new Ledger();',
                '}',
                '',
            ].join('\n'),
        );
        const c = calls(edges);
        // Both the class-targeting edge and the constructor edge survive.
        expect(c).toContainEqual(['svc.ts::run', 'svc.ts::Ledger']);
        expect(c).toContainEqual(['svc.ts::run', 'svc.ts::Ledger.Ledger.constructor']);
    });
});

/**
 * The end-to-end goal across every supported language with a constructor/factory
 * concept: an instantiator lands in the blast radius of what the constructor
 * body calls. Each fixture has `helper` (called by the constructor body) and a
 * `run`/`Run.go` that instantiates the class — after the fix, a reverse walk
 * from `helper` must reach the instantiator. Covers the four resolution shapes:
 * distinct-name ctor (TS/JS/Python/PHP/Swift, class node → redirect), plain-call
 * factory (Go/Elixir/Rust, normal resolution), same-name ctor collision
 * (Java/C#/Dart, constructor tier), `.new` idiom (Ruby), and synthesized
 * primary-constructor bodies (Kotlin/Scala).
 */
describe('constructor blast-radius connects the instantiator — all languages', () => {
    const CASES: Array<{ lang: string; file: string; helper: string; from: string; src: string }> = [
        {
            lang: 'Java',
            file: 'S.java',
            helper: 'S.java::Ledger.helper',
            from: 'S.java::Run.go',
            src: 'class Ledger {\n String root;\n Ledger(String p) { this.root = helper(p); }\n static String helper(String p) { return p.trim(); }\n}\nclass Run { Ledger go() { return new Ledger("/x"); } }\n',
        },
        {
            lang: 'C#',
            file: 'S.cs',
            helper: 'S.cs::Ledger.Helper',
            from: 'S.cs::Run.Go',
            src: 'class Ledger {\n string root;\n public Ledger(string p) { root = Helper(p); }\n static string Helper(string p) => p.Trim();\n}\nclass Run { Ledger Go() { return new Ledger("/x"); } }\n',
        },
        {
            lang: 'Dart',
            file: 's.dart',
            helper: 's.dart::helper',
            from: 's.dart::run',
            src: "String helper(String p) { return p.trim(); }\nclass Ledger {\n String root;\n Ledger(String p) { root = helper(p); }\n}\nLedger run() { return Ledger('/x'); }\n",
        },
        {
            lang: 'Ruby',
            file: 's.rb',
            helper: 's.rb::helper',
            from: 's.rb::run',
            src: 'def helper(p)\n  p.strip\nend\nclass Ledger\n  def initialize(p)\n    @root = helper(p)\n  end\nend\ndef run\n  Ledger.new("/x")\nend\n',
        },
        {
            lang: 'Rust',
            file: 's.rs',
            helper: 's.rs::helper',
            from: 's.rs::run',
            src: 'fn helper(p: &str) -> String { p.trim().to_string() }\nstruct Ledger { root: String }\nimpl Ledger {\n fn new(p: &str) -> Ledger { Ledger { root: helper(p) } }\n}\nfn run() -> Ledger { Ledger::new("/x") }\n',
        },
        {
            lang: 'Kotlin',
            file: 's.kt',
            helper: 's.kt::helper',
            from: 's.kt::run',
            src: 'fun helper(p: String): String { return p.trim() }\nclass Ledger(p: String) {\n val root: String = helper(p)\n}\nfun run(): Ledger { return Ledger("/x") }\n',
        },
        {
            lang: 'Scala',
            file: 's.scala',
            helper: 's.scala::H.helper',
            from: 's.scala::Run.go',
            src: 'object H { def helper(p: String): String = p.trim }\nclass Ledger(p: String) {\n val root: String = H.helper(p)\n}\nobject Run { def go(): Ledger = new Ledger("/x") }\n',
        },
    ];

    for (const c of CASES) {
        it(`${c.lang}: instantiator reaches the constructor body`, async () => {
            const edges = await edgesFor(c.file, c.src);
            expect(blastConnects(edges, c.from, c.helper)).toBe(true);
        });
    }
});
