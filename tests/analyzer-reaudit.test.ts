import { describe, expect, it } from 'vitest';
import { analyze } from '../packages/typescript-analyzer/index.js';
import { assertClosedGraph, fixtureFile, modelFor, node, reaches } from './analyzer.helpers.js';

describe('application re-verification regressions', () => {
  it.each([
    ['method', 'const object = { [key()]() { hidden(); } }; done();'],
    ['getter', 'const object = { get [key()]() { hidden(); return 1; } }; done();'],
    ['setter', 'const object = { set [key()](value) { hidden(); } }; done();'],
  ])('evaluates computed object %s names without entering their bodies', (_kind, body) => {
    const model = modelFor(body);
    expect(model.calls.map(call => call.name)).toEqual(['key', 'done']);
    expect(reaches(model, node(model, 'key()', 'call').id, node(model, 'done()', 'call').id)).toBe(true);
    assertClosedGraph(model);
  });

  it('marks a class expression opaque even when it contains no calls', () => {
    const model = modelFor('const Local = class { static value = 1; }; done();');
    expect(model.nodes.some(candidate => candidate.kind === 'unsupported' && candidate.astKind === 'ClassExpression')).toBe(true);
    expect(model.diagnostics.some(diagnostic => diagnostic.code === 'UNSUPPORTED')).toBe(true);
  });

  it.each([
    ['for-of', 'for (const { x = hidden() } of items) { use(x); }'],
    ['for-in', 'for (const [x = hidden()] in items) { use(x); }'],
  ])('marks %s destructuring bindings opaque instead of silently dropping defaults', (_kind, body) => {
    const model = modelFor(body);
    expect(model.nodes.some(candidate => candidate.kind === 'unsupported' && candidate.detail?.includes('Destructuring'))).toBe(true);
    expect(model.calls.map(call => call.name)).not.toContain('hidden');
    expect(model.calls.map(call => call.name)).toContain('use');
  });

  it('evaluates an iteration assignment target on every iteration before the body', () => {
    const model = modelFor('for (output[index()] of values()) { work(); } done();');
    expect(model.calls.map(call => call.name)).toEqual(expect.arrayContaining(['values', 'index', 'work', 'done']));
    const index = node(model, 'index()', 'call');
    expect(reaches(model, index.id, node(model, 'work()', 'call').id)).toBe(true);
    expect(reaches(model, node(model, 'work()', 'call').id, index.id)).toBe(true);
  });

  it.each(['\n', '\r\n'])('rejects a column that spills into the next line (%j)', newline => {
    const sourceText = `// heading${newline}function main(){ return 1; }`;
    expect(() => analyze({ file: fixtureFile, line: 1, column: 11 + newline.length, sourceText })).toThrow('outside the source line');
  });

  it('evaluates a destructuring assignment RHS before an opaque binding', () => {
    const model = modelFor('({ x = hidden() } = source()); use(x);');
    expect(model.calls.map(call => call.name)).toEqual(['source', 'use']);
    expect(model.nodes.some(candidate => candidate.kind === 'unsupported')).toBe(true);
  });

  it('does not fabricate default calls in an iteration destructuring assignment', () => {
    const model = modelFor('for ({ x = hidden() } of values()) { use(x); }');
    expect(model.calls.map(call => call.name)).toEqual(['values', 'use']);
    expect(model.nodes.some(candidate => candidate.kind === 'unsupported')).toBe(true);
  });

  it('marks iteration resource disposal as opaque', () => {
    const model = modelFor('for (using item of values()) { use(item); }');
    expect(model.nodes.some(candidate => candidate.kind === 'unsupported' && candidate.detail?.includes('Resource disposal'))).toBe(true);
  });

  it('analyzes a representative on-disk PCF/React-style TSX control', () => {
    const file = new URL('../fixtures/react/control.tsx', import.meta.url).pathname;
    const model = analyze({ file, line: 15, column: 3 });
    expect(model.entryFunction.name).toBe('renderControl');
    expect(model.calls.map(call => call.name)).toEqual(['helper', 'formatTitle']);
    expect(model.calls.every(call => call.resolution === 'resolved')).toBe(true);
    expect(model.calls.map(call => call.name)).not.toContain('context.notifyOutputChanged');
    expect(model.nodes.some(candidate => candidate.kind === 'condition')).toBe(true);
    assertClosedGraph(model);
  });
});
