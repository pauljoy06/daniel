import { describe, expect, it } from 'vitest';
import { analyze } from '../packages/typescript-analyzer/index.js';
import { assertClosedGraph, fixtureFile, modelFor, node } from './analyzer.helpers.js';

describe('TypeScript analyzer model contract and inputs', () => {
  it('is deterministic across repeated analysis', () => {
    const first = modelFor('if (x) left(); else right(); done();');
    const second = modelFor('if (x) left(); else right(); done();');
    expect(second).toEqual(first);
  });

  it('reports exact AST kind and one-based UTF-16 source provenance', () => {
    const model = modelFor('const emoji = "😀"; target();');
    const call = node(model, 'target()');
    expect(call.astKind).toBe('CallExpression');
    expect(call.source).toMatchObject({ file: fixtureFile, startLine: 1 });
    expect(call.source.startColumn).toBe(40);
    expect(call.source.endColumn).toBe(48);
    expect(model.calls.find((candidate) => candidate.nodeId === call.id)?.source).toEqual(call.source);
    for (const block of model.nodes.filter((candidate) => candidate.kind === 'basicBlock')) {
      expect(block.statements?.length).toBeGreaterThan(0);
    }
  });

  it('groups consecutive ordinary non-call statements into a basic block', () => {
    const model = modelFor('let a = 1; a += 2; a *= 3; finish(a);');
    const block = model.nodes.find((candidate) => candidate.kind === 'basicBlock');
    expect(block?.statements).toHaveLength(3);
    expect(block?.label).toContain('let a = 1');
  });

  it('parses TSX and preserves JSX source locations', () => {
    const file = fixtureFile.replace(/\.ts$/, '.tsx');
    const sourceText = 'function main(){   const view = <Button onClick={() => act()}>Save</Button>; render(view); }';
    const model = analyze({ file, line: 1, column: 20, sourceText });
    expect(model.entryFunction.name).toBe('main');
    expect(model.calls.map((call) => call.name)).toContain('render');
    expect(model.calls.map((call) => call.name)).not.toContain('act');
    expect(model.nodes.every((candidate) => candidate.source.file === file)).toBe(true);
  });

  it('uses sourceText as an unsaved overlay without reading fixture contents', () => {
    const model = analyze({
      file: fixtureFile,
      line: 1,
      column: 20,
      sourceText: 'function main(){   unsavedOnly(); }',
    });
    expect(model.calls.map((call) => call.name)).toEqual(['unsavedOnly']);
    expect(model.entryFunction.name).toBe('main');
  });

  it.each([
    ['zero line', { file: fixtureFile, line: 0, column: 1 }],
    ['zero column', { file: fixtureFile, line: 1, column: 0 }],
    ['cursor outside a function', { file: fixtureFile, line: 1, column: 1, sourceText: 'const value = 1;' }],
    ['missing file', { file: `${fixtureFile}.missing`, line: 1, column: 1 }],
  ])('rejects invalid input: %s', (_name, params) => {
    expect(() => analyze(params)).toThrowError();
  });

  it('returns a closed schema-v1 graph with unique IDs and linked calls', () => {
    const model = modelFor('prepare(); let value = 1; finish(value);');
    expect(model.schemaVersion).toBe(1);
    expect(new Set(model.nodes.map((candidate) => candidate.id)).size).toBe(model.nodes.length);
    expect(new Set(model.edges.map((candidate) => candidate.id)).size).toBe(model.edges.length);
    expect(new Set(model.calls.map((candidate) => candidate.id)).size).toBe(model.calls.length);
    for (const call of model.calls) {
      expect(model.nodes.find((candidate) => candidate.id === call.nodeId)).toMatchObject({ kind: 'call', callSiteId: call.id });
    }
    assertClosedGraph(model);
  });

  it('allows conservative exception edges without requiring implicit exceptions', () => {
    const model = modelFor('try { mayThrow(); } catch (error) { recover(error); }');
    const exceptionEdges = model.edges.filter((candidate) => candidate.type === 'exception');
    expect(exceptionEdges.length).toBeGreaterThanOrEqual(0);
    if (exceptionEdges.length > 0) expect(exceptionEdges.some((candidate) => candidate.from === node(model, 'mayThrow()').id)).toBe(true);
  });
});
