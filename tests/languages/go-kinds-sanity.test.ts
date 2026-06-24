import { describe, expect, it } from 'bun:test';
import type { SgNode } from '@ast-grep/napi';
import { parseAsync } from '@ast-grep/napi';
import { GO_FIELDS, GO_KINDS } from '../../src/languages/go/kinds';
import '../../src/parser/languages';

// Grammar-drift guard: a Go fixture exercising every centralized KIND. If a
// `@ast-grep/lang-go` bump renames/removes a node, the assertion below fails
// loudly instead of the extractor silently skipping a branch.
const FIXTURE = `package main

import "fmt"

import (
	"os"
	f "path/filepath"
)

type Reader interface {
	Read() string
}

type Base struct {
	id int
}

type Server struct {
	Base
	name string
}

var globalReader Reader

func NewServer() *Server {
	return &Server{name: "x"}
}

func (s *Server) Handle(req *os.File) string {
	x := NewServer()
	y := Server{}
	var z Base
	_ = x
	_ = y
	_ = z
	s.Read()

	for i := 0; i < 3; i++ {
		fmt.Println(i)
	}

	if s.name == "x" {
		fmt.Println("hi")
	} else if s.name == "y" {
		fmt.Println("bye")
	}

	switch s.name {
	case "a":
		return "a"
	default:
		return "d"
	}

	var any interface{} = s
	switch any.(type) {
	case *Server:
		return "server"
	}

	ch := make(chan int)
	select {
	case v := <-ch:
		return fmt.Sprint(v)
	default:
		return ""
	}
}

func (s *Server) Read() string {
	return s.name
}

func Test_main() {
	_ = NewServer()
}
`;

function collectKinds(root: SgNode): Set<string> {
    const present = new Set<string>();
    const stack: SgNode[] = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
            continue;
        }
        present.add(String(node.kind()));
        for (const child of node.children()) {
            stack.push(child);
        }
    }
    return present;
}

describe('go kinds sanity', () => {
    it('every GO_KINDS value appears in the parsed Go fixture', async () => {
        const root = (await parseAsync('go' as never, FIXTURE)).root();
        const present = collectKinds(root);
        const missing = Object.entries(GO_KINDS)
            .filter(([, kind]) => !present.has(kind))
            .map(([key, kind]) => `${key} -> '${kind}'`);
        expect(missing).toEqual([]);
    });

    it('every GO_FIELDS value resolves on some node in the fixture', async () => {
        const root = (await parseAsync('go' as never, FIXTURE)).root();
        // Walk the tree, attempting each field on every node; collect the
        // field names that successfully resolve at least once.
        const resolved = new Set<string>();
        const stack: SgNode[] = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) {
                continue;
            }
            for (const field of Object.values(GO_FIELDS)) {
                if (node.field(field)) {
                    resolved.add(field);
                }
            }
            for (const child of node.children()) {
                stack.push(child);
            }
        }
        const missing = Object.entries(GO_FIELDS)
            .filter(([, field]) => !resolved.has(field))
            .map(([key, field]) => `${key} -> '${field}'`);
        expect(missing).toEqual([]);
    });
});
