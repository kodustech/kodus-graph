// tests/no-network.test.ts
//
// On-device guarantee, made falsifiable.
//
// kodus-graph's selling point for regulated teams is that source never leaves
// the machine: parsing is local (ast-grep/tree-sitter), and analysis reads the
// graph JSON — no API is called to read or reason about code. This test proves
// it instead of asserting it: it traps every network primitive (fetch, http,
// https, raw sockets, DNS), runs the full parse path over a fixture, and fails
// if any of them fire. If someone later adds a phone-home, a telemetry ping, or
// a dependency that fetches at runtime, this goes red.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { resolve } from 'node:path';
import { parseBatch } from '../src/parser/batch';
import { discoverFiles } from '../src/parser/discovery';

const FIXTURE = resolve('tests/fixtures/sample-repo');

interface Trap {
    restore: () => void;
}

/** Record any outbound network attempt as `"<label> <arg>"`. */
function installNetworkTraps(record: (call: string) => void): Trap {
    const originalFetch = globalThis.fetch;
    const netConnect = net.Socket.prototype.connect;
    const httpRequest = http.request;
    const httpGet = http.get;
    const httpsRequest = https.request;
    const httpsGet = https.get;
    const dnsLookup = dns.lookup;
    const dnsResolve = dns.resolve;

    globalThis.fetch = ((input: unknown) => {
        record(`fetch ${String(input)}`);
        throw new Error('network blocked in no-network test');
    }) as typeof fetch;

    net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
        record(`net.connect ${JSON.stringify(args[0])}`);
        throw new Error('network blocked in no-network test');
    } as typeof net.Socket.prototype.connect;

    const trapReq =
        (label: string) =>
        (...args: unknown[]): never => {
            record(`${label} ${String(args[0])}`);
            throw new Error('network blocked in no-network test');
        };
    http.request = trapReq('http.request') as typeof http.request;
    http.get = trapReq('http.get') as typeof http.get;
    https.request = trapReq('https.request') as typeof https.request;
    https.get = trapReq('https.get') as typeof https.get;
    (dns as { lookup: unknown }).lookup = trapReq('dns.lookup');
    (dns as { resolve: unknown }).resolve = trapReq('dns.resolve');

    return {
        restore() {
            globalThis.fetch = originalFetch;
            net.Socket.prototype.connect = netConnect;
            http.request = httpRequest;
            http.get = httpGet;
            https.request = httpsRequest;
            https.get = httpsGet;
            (dns as { lookup: unknown }).lookup = dnsLookup;
            (dns as { resolve: unknown }).resolve = dnsResolve;
        },
    };
}

describe('on-device guarantee: the parse path makes no network calls', () => {
    let calls: string[];
    let trap: Trap;

    beforeEach(() => {
        calls = [];
        trap = installNetworkTraps((c) => calls.push(c));
    });

    afterEach(() => {
        trap.restore();
    });

    it('discovers and parses a repo without touching the network', async () => {
        const files = discoverFiles(FIXTURE, undefined);
        expect(files.length).toBeGreaterThan(0);

        const graph = await parseBatch(files, FIXTURE, {});
        // Parsing really happened (the guarantee is meaningful only if work was done).
        expect(graph.functions.length).toBeGreaterThan(0);

        // The whole point: nothing reached for the network.
        expect(calls).toEqual([]);
    });
});
