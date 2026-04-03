import { describe, it, expect } from 'bun:test';
import { GraphInputSchema } from '../../src/shared/schemas';

describe('GraphInputSchema', () => {
  const validNode = {
    kind: 'Function',
    name: 'doStuff',
    qualified_name: 'src/a.ts::doStuff',
    file_path: 'src/a.ts',
    line_start: 1,
    line_end: 10,
    language: 'typescript',
    is_test: false,
    file_hash: 'abc123',
  };

  const validEdge = {
    kind: 'CALLS',
    source_qualified: 'src/a.ts::doStuff',
    target_qualified: 'src/b.ts::helper',
    file_path: 'src/a.ts',
    line: 5,
  };

  it('should validate a correct graph input', () => {
    const input = { nodes: [validNode], edges: [validEdge] };
    const result = GraphInputSchema.parse(input);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });

  it('should accept nodes with optional fields', () => {
    const nodeWithOptionals = {
      ...validNode,
      parent_name: 'MyClass',
      params: '(x: number)',
      return_type: 'void',
      modifiers: 'async',
    };
    const result = GraphInputSchema.parse({ nodes: [nodeWithOptionals], edges: [] });
    expect(result.nodes[0].parent_name).toBe('MyClass');
  });

  it('should accept edges with optional confidence', () => {
    const edgeWithConfidence = { ...validEdge, confidence: 0.85 };
    const result = GraphInputSchema.parse({ nodes: [], edges: [edgeWithConfidence] });
    expect(result.edges[0].confidence).toBe(0.85);
  });

  it('should reject input missing nodes array', () => {
    expect(() => GraphInputSchema.parse({ edges: [] })).toThrow();
  });

  it('should reject input missing edges array', () => {
    expect(() => GraphInputSchema.parse({ nodes: [] })).toThrow();
  });

  it('should reject node with missing required field', () => {
    const badNode = { kind: 'Function', name: 'x' };
    expect(() => GraphInputSchema.parse({ nodes: [badNode], edges: [] })).toThrow();
  });

  it('should reject edge with wrong type for line', () => {
    const badEdge = { ...validEdge, line: 'not-a-number' };
    expect(() => GraphInputSchema.parse({ nodes: [], edges: [badEdge] })).toThrow();
  });

  it('should accept empty graph', () => {
    const result = GraphInputSchema.parse({ nodes: [], edges: [] });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
