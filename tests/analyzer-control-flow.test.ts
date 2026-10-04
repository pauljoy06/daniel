import { describe, expect, it } from 'vitest';
import { assertClosedGraph, edge, modelFor, node, reaches } from './analyzer.helpers.js';

describe('TypeScript analyzer control flow', () => {
  it('creates synthetic entry/exit and joins if branches before the following block', () => {
    const model = modelFor('if (ok) { a(); } else { b(); } c();');
    const condition = node(model, 'ok');
    const a = node(model, 'a()');
    const b = node(model, 'b()');
    const c = node(model, 'c()');
    expect(model.nodes.find((n) => n.id === model.entryNodeId)).toMatchObject({ kind: 'entry', synthetic: true });
    expect(model.nodes.find((n) => n.id === model.exitNodeId)).toMatchObject({ kind: 'exit', synthetic: true });
    expect(edge(model, condition, a, 'true')).toBeDefined();
    expect(edge(model, condition, b, 'false')).toBeDefined();
    expect(edge(model, a, c)).toBeDefined();
    expect(edge(model, b, c)).toBeDefined();
    assertClosedGraph(model);
  });

  it('does not add fallthrough after return and prunes unreachable statements', () => {
    const model = modelFor('if (stop) return; after(); return; unreachable();');
    expect(edge(model, node(model, 'return'), node(model, 'after()'))).toBeUndefined();
    expect(model.nodes.some((n) => n.label.includes('unreachable'))).toBe(false);
    expect(model.edges.some((e) => e.type === 'return' && e.to === model.exitNodeId)).toBe(true);
  });

  it('models switch case matching, fallthrough, default and break', () => {
    const model = modelFor('switch (x) { case 1: a(); case 2: b(); break; default: d(); } z();');
    const first = node(model, 'x === 1', 'condition');
    const second = node(model, 'x === 2', 'condition');
    expect(edge(model, first, node(model, 'a()', 'call'), 'case')).toBeDefined();
    expect(edge(model, first, second, 'default')).toBeDefined();
    expect(edge(model, second, node(model, 'd()', 'call'), 'default')).toBeDefined();
    expect(edge(model, node(model, 'a()', 'call'), node(model, 'b()', 'call'), 'next')).toBeDefined();
    expect(reaches(model, node(model, 'break', 'break').id, node(model, 'z()', 'call').id)).toBe(true);
    expect(reaches(model, node(model, 'break', 'break').id, node(model, 'd()', 'call').id)).toBe(false);
  });

  it('routes unmatched switch cases to the continuation without a default', () => {
    const model = modelFor('switch (x) { case 1: a(); break; case 2: b(); } z();');
    expect(edge(model, node(model, 'x === 2', 'condition'), node(model, 'z()', 'call'), 'default')).toBeDefined();
  });

  it('tests cases after a middle default before selecting the default body', () => {
    const model = modelFor('switch (x) { case 1: a(); break; default: d(); case 2: b(); } z();');
    expect(edge(model, node(model, 'x === 2', 'condition'), node(model, 'd()', 'call'), 'default')).toBeDefined();
    expect(edge(model, node(model, 'd()', 'call'), node(model, 'b()', 'call'), 'next')).toBeDefined();
  });

  it('models classic for init, condition, update, back edge, and continue to update', () => {
    const model = modelFor('for (let i = init(); test(i); i = step(i)) { if (skip(i)) continue; work(i); } done();');
    const update = node(model, 'step(i)', 'call');
    expect(edge(model, node(model, 'continue'), update, 'continue')).toBeDefined();
    const back = model.edges.find((e) => e.type === 'back')!;
    expect(reaches(model, update.id, back.from)).toBe(true);
    expect(reaches(model, back.to, node(model, 'test(i)', 'call').id)).toBe(true);
    expect(node(model, 'init()').source.startColumn).toBeLessThan(node(model, 'test(i)').source.startColumn);
  });

  it.each([
    ['for-of', 'for (const item of items) { use(item); } done();'],
    ['while', 'while (ready()) { tick(); } done();'],
    ['do-while', 'do { tick(); } while (ready()); done();'],
  ])('models %s loops with body, back edge, and exit', (_name, body) => {
    const model = modelFor(body);
    expect(model.nodes.some((n) => n.kind === 'loop')).toBe(true);
    expect(model.edges.some((e) => e.type === 'back')).toBe(true);
    expect(model.nodes.some((n) => n.label.includes('done()'))).toBe(true);
  });

  it('cannot bypass the finalizer on a normal return', () => {
    const model = modelFor('try { return value(); } finally { cleanup(); }');
    const cleanups = new Set(model.calls.filter(c => c.name === 'cleanup').map(c => c.nodeId));
    expect(cleanups.size).toBeGreaterThan(0);
    const ret = node(model, 'return value', 'return');
    expect(reaches(model, ret.id, model.exitNodeId)).toBe(true);
    expect(reaches(model, ret.id, model.exitNodeId, cleanups)).toBe(false);
  });

  it('runs finally before a loop continue reaches the update', () => {
    const model = modelFor('for (let i=0; ok(); update()) { try { continue; } finally { cleanup(); } }');
    const cleanup = new Set(model.calls.filter(c => c.name === 'cleanup').map(c => c.nodeId));
    expect(reaches(model, node(model, 'continue', 'continue').id, node(model, 'update()', 'call').id, cleanup)).toBe(false);
    expect(reaches(model, node(model, 'continue', 'continue').id, node(model, 'update()', 'call').id)).toBe(true);
  });

  it('binds nested break and continue to the nearest loop', () => {
    const model = modelFor('while (outer()) { for (;;) { if (x) continue; break; } afterInner(); break; } done();');
    const continues = model.nodes.filter((n) => n.kind === 'continue');
    const breaks = model.nodes.filter((n) => n.kind === 'break');
    expect(continues).toHaveLength(1);
    expect(breaks).toHaveLength(2);
    expect(model.edges.filter((e) => e.type === 'continue')).toHaveLength(1);
    expect(model.edges.filter((e) => e.type === 'break')).toHaveLength(2);
    expect(new Set(model.edges.filter((e) => e.type === 'break').map((e) => e.to)).size).toBe(2);
  });

  it.each([
    ['normal catch/finally', 'try { risky(); } catch (e) { recover(e); } finally { cleanup(); } done();'],
    ['return through finally', 'try { return value(); } finally { cleanup(); }'],
    ['throw through finally', 'try { throw failure(); } finally { cleanup(); }'],
    ['finalizer overrides return', 'try { return first(); } finally { return second(); }'],
  ])('models try flow: %s', (_name, body) => {
    const model = modelFor(body);
    expect(model.nodes.some((n) => n.label.includes('cleanup()')) || body.includes('return second')).toBe(true);
    expect(model.edges.some((e) => e.type === 'finally')).toBe(true);
    if (body.includes('return second')) {
      expect(model.edges.some((e) => e.type === 'return' && e.from === node(model, 'return second').id)).toBe(true);
      expect(model.nodes.some((n) => n.label.includes('first') && n.kind === 'call')).toBe(true);
    }
  });
});
