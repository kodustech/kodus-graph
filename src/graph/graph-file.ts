import { closeSync, existsSync, openSync, readFileSync, readSync } from 'fs';

/**
 * Read a graph JSON file, even one too large to hold as a single string.
 *
 * `JSON.parse(readFileSync(path, 'utf-8'))` needs the whole file as one string.
 * Node caps strings at ~512 MB (`Cannot create a string longer than 0x1fffffe8
 * characters`), so a large repo's graph could be written — the writer streams —
 * but never read back under Node.
 *
 * The whole-file parse stays the first choice: it is the fastest and leanest
 * path on both Bun and Node while the file fits in a string. Only when reading
 * the file as a string fails does this fall back to a line-by-line read of the
 * layout `writeGraphJSON` emits (one node or edge per line):
 *
 *   {"metadata":{…},"nodes":[
 *   {…node…},
 *   {…node…}
 *   ],"edges":[
 *   {…edge…}
 *   ]}
 *
 * JSON strings never contain a raw newline, so a line is always a whole record.
 * `opts.stream` forces the line-by-line path (tests).
 */
export function readGraphFile(path: string, opts: { stream?: boolean; chunkBytes?: number } = {}): unknown {
    const chunkBytes = opts.chunkBytes ?? CHUNK_BYTES;
    if (opts.stream) {
        const streamed = readWriterLayout(path, chunkBytes);
        if (!streamed) {
            throw new Error(`not in the writeGraphJSON line layout: ${path}`);
        }
        return streamed;
    }
    let text: string;
    try {
        text = readFileSync(path, 'utf-8');
    } catch (err) {
        // Too large for a string (or unreadable): stream it if it's our layout.
        const streamed = existsSync(path) ? readWriterLayout(path, chunkBytes) : null;
        if (streamed) {
            return streamed;
        }
        throw err;
    }
    return JSON.parse(text);
}

const HEADER = '{"metadata":';
const NODES_OPEN = ',"nodes":[';
const EDGES_OPEN = '],"edges":[';
const CHUNK_BYTES = 16 * 1024 * 1024;

function readWriterLayout(
    path: string,
    chunkBytes: number,
): { metadata: unknown; nodes: unknown[]; edges: unknown[] } | null {
    const fd = openSync(path, 'r');
    try {
        const lines = lineReader(fd, chunkBytes);
        const first = lines.next();
        if (first.done || !first.value.startsWith(HEADER) || !first.value.endsWith(NODES_OPEN)) {
            return null;
        }
        const metadata = JSON.parse(first.value.slice(HEADER.length, -NODES_OPEN.length));
        const nodes: unknown[] = [];
        const edges: unknown[] = [];
        let target = nodes;
        let closed = false;
        for (const raw of lines) {
            if (raw === EDGES_OPEN && target === nodes) {
                target = edges;
                continue;
            }
            if (raw === ']}' && target === edges) {
                closed = true;
                continue;
            }
            if (raw === '') {
                continue; // trailing newline after `]}` (stdout output)
            }
            if (closed) {
                return null; // content after the closing bracket: not our layout
            }
            target.push(JSON.parse(raw.endsWith(',') ? raw.slice(0, -1) : raw));
        }
        return closed ? { metadata, nodes, edges } : null;
    } catch {
        return null; // anything unexpected: let the whole-file parse decide
    } finally {
        closeSync(fd);
    }
}

/** Yield the file's lines, decoding each on its own (a newline byte never splits a UTF-8 sequence). */
function* lineReader(fd: number, chunkBytes: number): Generator<string> {
    const chunk = Buffer.allocUnsafe(chunkBytes);
    let pending: Buffer = Buffer.alloc(0);
    for (;;) {
        const n = readSync(fd, chunk, 0, chunkBytes, null);
        if (n === 0) {
            break;
        }
        let buf = pending.length > 0 ? Buffer.concat([pending, chunk.subarray(0, n)]) : chunk.subarray(0, n);
        let start = 0;
        for (let nl = buf.indexOf(0x0a, start); nl !== -1; nl = buf.indexOf(0x0a, start)) {
            yield buf.toString('utf-8', start, nl);
            start = nl + 1;
        }
        // Copy the tail: `chunk` is reused by the next read.
        buf = buf.subarray(start);
        pending = Buffer.from(buf);
    }
    if (pending.length > 0) {
        yield pending.toString('utf-8');
    }
}
