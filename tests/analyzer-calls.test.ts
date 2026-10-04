import { describe, expect, it } from 'vitest';
import { analyze } from '../packages/typescript-analyzer/index.js';
import { edge, fixtureFile, modelFor, node, reaches } from './analyzer.helpers.js';

describe('TypeScript analyzer expression and call semantics', () => {
  it('excludes calls inside nested function bodies', () => {
    const model = modelFor('outer(); function nested() { hidden(); } const arrow = () => alsoHidden(); after();');
    expect(model.calls.map((call) => call.name)).toEqual(expect.arrayContaining(['outer', 'after']));
    expect(model.calls.map((call) => call.name)).not.toEqual(expect.arrayContaining(['hidden', 'alsoHidden']));
  });

  it('preserves JavaScript call evaluation order for nested arguments', () => {
    const model = modelFor('f(g(), h());');
    const g = node(model, 'g()');
    const h = node(model, 'h()');
    const f = node(model, 'f(');
    expect(edge(model, g, h)).toBeDefined();
    expect(edge(model, h, f)).toBeDefined();
    expect(model.calls.map((call) => call.name)).toEqual(['g', 'h', 'f']);
  });

  it.each([
    ['and', 'ready() && run();', 'ready()', 'run()'],
    ['or', 'cached() || load();', 'cached()', 'load()'],
    ['nullish', 'known() ?? fallback();', 'known()', 'fallback()'],
  ])('branches for short-circuit %s', (_name, body, leftLabel, rightLabel) => {
    const model = modelFor(body);
    const left = node(model, leftLabel, 'call');
    const right = node(model, rightLabel, 'call');
    const condition = node(model, leftLabel, 'condition');
    expect(edge(model, left, condition, 'next')).toBeDefined();
    const branch = _name === 'or' ? 'false' : 'true';
    expect(edge(model, condition, right, branch)).toBeDefined();
    expect(model.edges.some(e => e.from === condition.id && e.type === (branch === 'true' ? 'false' : 'true') && e.to !== right.id)).toBe(true);
  });

  it('branches between ternary arms and rejoins', () => {
    const model = modelFor('const value = choose() ? yes() : no(); use(value);');
    const condition = node(model, 'choose()', 'condition');
    expect(edge(model, condition, node(model, 'yes()'), 'true')).toBeDefined();
    expect(edge(model, condition, node(model, 'no()'), 'false')).toBeDefined();
    expect(reaches(model, node(model, 'yes()', 'call').id, node(model, 'use(value)', 'call').id)).toBe(true);
    expect(reaches(model, node(model, 'no()', 'call').id, node(model, 'use(value)', 'call').id)).toBe(true);
    expect(reaches(model, node(model, 'yes()', 'call').id, node(model, 'no()', 'call').id)).toBe(false);
  });

  it('resolves direct local functions but leaves dynamic property access unresolved', () => {
    const prefix = 'function local() {}\n';
    const model = modelFor('local(); object[key]();', { prefix });
    expect(model.calls.find((call) => call.name === 'local')).toMatchObject({ resolution: 'resolved', target: { name: 'local' } });
    expect(model.calls.find((call) => call.source.startLine === 2 && call.name !== 'local')).toMatchObject({ resolution: 'unresolved' });
  });

  it('resolves import aliases to their declaration target', () => {
    const prefix = "import { helper as renamed } from './helper.js';\n";
    const model = modelFor('renamed();', { prefix });
    expect(model.calls).toContainEqual(expect.objectContaining({ name: 'renamed', resolution: 'resolved', target: expect.objectContaining({ name: 'helper' }) }));
  });

  it('represents new expressions as call nodes', () => {
    const model = modelFor('const service = new Service(dep());');
    expect(model.nodes.filter((candidate) => candidate.kind === 'call')).toHaveLength(2);
    expect(model.calls.map((call) => call.name)).toEqual(['dep', 'Service']);
  });

  it('labels async functions and await sites', () => {
    const model = analyze({
      file: fixtureFile,
      line: 1,
      column: 26,
      sourceText: 'async function main(){   const value = await load(); await save(value); }',
    });
    expect(model.entryFunction.async).toBe(true);
    expect(model.calls.map((call) => call.name)).toEqual(['load', 'save']);
    const awaits = model.nodes.filter(candidate => candidate.astKind === 'AwaitExpression');
    expect(awaits).toHaveLength(2);
    for (const call of model.calls) expect(model.edges.some(e => e.from === call.nodeId && awaits.some(n => n.id === e.to))).toBe(true);
  });

  it('emits an explicit diagnostic and unsupported node instead of inventing order', () => {
    const model = modelFor('using resource = acquire(); consume(resource);');
    expect(model.diagnostics.length).toBeGreaterThan(0);
    expect(model.nodes.some((candidate) => candidate.kind === 'unsupported')).toBe(true);
  });

  it('does not resolve a mutable function binding to its initializer', () => {
    const model = modelFor('let handler = () => first(); handler = () => second(); handler();');
    expect(model.calls.find(c => c.name === 'handler')).toMatchObject({ resolution: 'unresolved' });
    expect(model.calls.map(c => c.name)).not.toContain('first');
    expect(model.calls.map(c => c.name)).not.toContain('second');
  });

  it('preserves short-circuit predicate outcomes inside an if', () => {
    const model = modelFor('if ((ready() && valid()) as boolean) accept(); else reject();');
    const ready = node(model, 'ready()', 'condition');
    const valid = node(model, 'valid()', 'condition');
    expect(edge(model, ready, node(model, 'reject()', 'call'), 'false')).toBeDefined();
    expect(edge(model, ready, node(model, 'valid()', 'call'), 'true')).toBeDefined();
    expect(edge(model, valid, node(model, 'accept()', 'call'), 'true')).toBeDefined();
    expect(edge(model, valid, node(model, 'reject()', 'call'), 'false')).toBeDefined();
  });

  it('preserves predicate outcomes in a loop without permitting a skipped RHS to enter the body', () => {
    const model = modelFor('while (ready() && valid()) { work(); } done();');
    expect(edge(model, node(model, 'ready()', 'condition'), node(model, 'done()', 'call'), 'false')).toBeDefined();
    expect(edge(model, node(model, 'valid()', 'condition'), node(model, 'work()', 'call'), 'true')).toBeDefined();
  });

  it('evaluates a destructuring initializer before an explicitly opaque binding', () => {
    const model = modelFor('const { x = fallback() } = source(); use(x);');
    const binding = model.nodes.find(n => n.kind === 'unsupported')!;
    expect(binding).toBeDefined();
    expect(edge(model, node(model, 'source()', 'call'), binding, 'next')).toBeDefined();
    expect(model.calls.map(c => c.name)).not.toContain('fallback');
  });

  it('does not invent calls in optional chains', () => {
    const model = modelFor('handler?.(argument()); after();');
    expect(model.nodes.some(n => n.kind === 'unsupported' && n.detail?.includes('Optional-chain'))).toBe(true);
    expect(model.calls.map(c => c.name)).toEqual(['after']);
  });
});
