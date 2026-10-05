import { describe, expect, it, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { DiagramLayoutError, isDiagramParams, layoutDiagram } from '../packages/diagram-layout/index.js';
import type { DiagramLayout, DiagramParams, DiagramNode, DiagramPoint } from '../packages/core/diagram.js';

const node = (id: string, width = 16, height = 5) => ({ id, width, height });
const branch: DiagramParams = {
  nodes: [node('entry'), node('condition', 20, 7), node('yes'), node('no'), node('exit')],
  edges: [
    { id: 'start', from: 'entry', to: 'condition' },
    { id: 'true', from: 'condition', to: 'yes', label: 'true', labelWidth: 4 },
    { id: 'false', from: 'condition', to: 'no', label: 'false', labelWidth: 5 },
    { id: 'yes-end', from: 'yes', to: 'exit' },
    { id: 'no-end', from: 'no', to: 'exit' },
  ],
};
const geometry = ({ elapsedMs: _, ...rest }: DiagramLayout) => rest;
const onBorder = (p: DiagramPoint, n: DiagramNode) => p.x >= n.x && p.x < n.x + n.width &&
  p.y >= n.y && p.y < n.y + n.height && (p.x === n.x || p.x === n.x + n.width - 1 || p.y === n.y || p.y === n.y + n.height - 1);

function checkGeometry(layout: DiagramLayout, input: DiagramParams): void {
  expect(layout.schemaVersion).toBe(1);
  expect(Number.isSafeInteger(layout.width)).toBe(true);
  expect(Number.isSafeInteger(layout.height)).toBe(true);
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.height).toBeGreaterThan(0);
  expect(layout.width).toBeLessThanOrEqual(1200);
  expect(layout.height).toBeLessThanOrEqual(12000);
  expect(layout.width * layout.height).toBeLessThanOrEqual(2_000_000);
  expect(layout.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(layout.nodes.map(n => n.id).sort()).toEqual(input.nodes.map(n => n.id).sort());
  expect(layout.edges.map(e => e.id).sort()).toEqual(input.edges.map(e => e.id).sort());
  const rectangles = [...layout.nodes, ...layout.edges.flatMap(e => e.label ? [{ ...e.label, height: 1 }] : [])];
  for (let i = 0; i < rectangles.length; i++) {
    const a = rectangles[i];
    for (const v of [a.x, a.y, a.width, a.height]) expect(Number.isSafeInteger(v)).toBe(true);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.width).toBeLessThanOrEqual(layout.width);
    expect(a.y + a.height).toBeLessThanOrEqual(layout.height);
    for (const b of rectangles.slice(0, i)) {
      expect(a.width === 0 || b.width === 0 || a.x + a.width <= b.x || b.x + b.width <= a.x ||
        a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  }
  for (const edge of layout.edges) {
    const original = input.edges.find(e => e.id === edge.id)!;
    expect(edge.from).toBe(original.from);
    expect(edge.to).toBe(original.to);
    expect(edge.label?.text).toBe(original.label);
    if (original.labelWidth !== undefined) expect(edge.label?.width).toBe(original.labelWidth);
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
    expect(onBorder(edge.points[0], layout.nodes.find(n => n.id === edge.from)!)).toBe(true);
    expect(onBorder(edge.points[edge.points.length - 1], layout.nodes.find(n => n.id === edge.to)!)).toBe(true);
    for (let i = 0; i < edge.points.length; i++) {
      const p = edge.points[i];
      expect(Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y)).toBe(true);
      expect(p.x >= 0 && p.x < layout.width && p.y >= 0 && p.y < layout.height).toBe(true);
      if (!i) continue;
      const q = edge.points[i - 1];
      expect(p.x === q.x || p.y === q.y).toBe(true);
      for (const n of layout.nodes) {
        const crosses = p.x === q.x ? p.x > n.x && p.x < n.x + n.width - 1 && Math.max(p.y, q.y) > n.y && Math.min(p.y, q.y) < n.y + n.height - 1 :
          p.y > n.y && p.y < n.y + n.height - 1 && Math.max(p.x, q.x) > n.x && Math.min(p.x, q.x) < n.x + n.width - 1;
        expect(crosses, `${edge.id} crosses ${n.id}`).toBe(false);
      }
    }
  }
}

describe('local terminal-cell diagram layout', () => {
  it('is deterministic, DOWN, orthogonal, collision-free and independent of input ordering', async () => {
    const first = await layoutDiagram(branch);
    checkGeometry(first, branch);
    expect(geometry(await layoutDiagram(branch))).toEqual(geometry(first));
    expect(geometry(await layoutDiagram({ nodes: [...branch.nodes].reverse(), edges: [...branch.edges].reverse() }))).toEqual(geometry(first));
    const entry = first.nodes.find(n => n.id === 'entry')!;
    const exit = first.nodes.find(n => n.id === 'exit')!;
    expect(exit.y).toBeGreaterThan(entry.y);
    expect(branch.nodes[0]).not.toHaveProperty('x');
  });

  it('preserves self-loops, parallel and back edges, disconnected nodes and special IDs', async () => {
    const input: DiagramParams = { nodes: [node('root'), node('__proto__'), node('孤立')], edges: [
      { id: 'loop', from: 'root', to: 'root', label: 'again', labelWidth: 5 },
      { id: 'a', from: 'root', to: '__proto__', label: 'first', labelWidth: 5 },
      { id: 'b', from: 'root', to: '__proto__', label: 'second', labelWidth: 6 },
      { id: 'back', from: '__proto__', to: 'root' },
    ] };
    const result = await layoutDiagram(input);
    checkGeometry(result, input);
    expect(result.edges.find(e => e.id === 'loop')!.points.length).toBeGreaterThanOrEqual(4);
    expect(result.edges.find(e => e.id === 'a')!.points).not.toEqual(result.edges.find(e => e.id === 'b')!.points);
  });

  it('uses caller-measured Unicode cell widths without rewriting label text', async () => {
    const input: DiagramParams = { nodes: [node('a', 6, 3), node('b', 160, 30)], edges: [
      { id: 'unicode', from: 'a', to: 'b', label: '界e\u0301👩‍💻', labelWidth: 5 },
    ] };
    const result = await layoutDiagram(input);
    checkGeometry(result, input);
    expect(result.edges[0].label).toMatchObject({ text: '界e\u0301👩‍💻', width: 5 });
  });

  it('supports absent, empty and zero-width labels and empty diagrams', async () => {
    expect(geometry(await layoutDiagram({ nodes: [], edges: [] }))).toEqual({ schemaVersion: 1, width: 1, height: 1, nodes: [], edges: [] });
    for (const label of [{}, { label: '', labelWidth: 0 }, { label: '界e\u0301' }]) {
      const input = { nodes: [node('a'), node('b')], edges: [{ id: 'edge', from: 'a', to: 'b', ...label }] };
      const result = await layoutDiagram(input);
      checkGeometry(result, input);
      if (label.label === '界e\u0301') expect(result.edges[0].label!.width).toBe(3);
    }
  });

  it.each([null, {}, { nodes: [], edges: {} }, { nodes: [node('a', 5)], edges: [] },
    { nodes: [node('a', 161)], edges: [] }, { nodes: [node('a', 6, 2)], edges: [] },
    { nodes: [node('a', 6, 31)], edges: [] }, { nodes: [node('a', NaN)], edges: [] },
    { nodes: [node('a', 6.5)], edges: [] }, { nodes: [node('a'), node('a')], edges: [] },
    { nodes: [node('a')], edges: [{ id: 'x', from: 'a', to: 'missing' }] },
    { nodes: [node('a')], edges: [{ id: 'x', from: 'a', to: 'a', label: 'bad\nlabel' }] },
    { nodes: [node('a')], edges: [{ id: 'x', from: 'a', to: 'a', label: 'a', labelWidth: Infinity }] },
    { nodes: [node('a')], edges: [{ id: 'x', from: 'a', to: 'a', labelWidth: 2 }] },
    { nodes: [node('a')], edges: [{ id: 'x', from: 'a', to: 'a' }, { id: 'x', from: 'a', to: 'a' }] },
  ])('rejects malformed params: %j', async value => {
    expect(isDiagramParams(value)).toBe(false);
    await expect(layoutDiagram(value as DiagramParams)).rejects.toMatchObject({ name: 'DiagramLayoutError', kind: 'invalid' });
  });

  it('bounds counts and label cells before invoking ELK', async () => {
    expect(isDiagramParams(branch)).toBe(true);
    for (const input of [
      { nodes: Array.from({ length: 301 }, (_, i) => node(`n${i}`)), edges: [] },
      { nodes: [node('a')], edges: Array.from({ length: 1501 }, (_, i) => ({ id: `e${i}`, from: 'a', to: 'a' })) },
      { nodes: [node('a')], edges: [{ id: 'x', from: 'a', to: 'a', label: 'x'.repeat(121) }] },
    ]) {
      expect(isDiagramParams(input)).toBe(false);
      await expect(layoutDiagram(input)).rejects.toMatchObject({ kind: 'oversize' });
    }
    expect(isDiagramParams({ nodes: Array.from({ length: 300 }, (_, i) => node(`n${i}`)), edges: [] })).toBe(true);
    expect(isDiagramParams({ nodes: [node('a')], edges: Array.from({ length: 1500 }, (_, i) => ({ id: `e${i}`, from: 'a', to: 'a' })) })).toBe(true);
  });

  it('rejects invalid final geometry rather than returning overlapping boxes', async () => {
    const spy = vi.spyOn(ELK.prototype, 'layout').mockResolvedValueOnce({ id: 'root', width: 300, height: 300,
      children: [{ id: 'n0', x: 12, y: 12 }, { id: 'n1', x: 12, y: 12 }], edges: [] });
    try {
      await expect(layoutDiagram({ nodes: [node('a'), node('b')], edges: [] })).rejects.toMatchObject({ kind: 'layout', message: expect.stringContaining('overlapping') });
    } finally { spy.mockRestore(); }
  });

  it('rejects diagonal, nonfinite, nonborder, interior-crossing routes and colliding labels', async () => {
    const spy = vi.spyOn(ELK.prototype, 'layout');
    const input = { nodes: [node('a', 6, 3), node('b', 6, 3)], edges: [{ id: 'edge', from: 'a', to: 'b', label: 'x', labelWidth: 1 }] };
    try {
      for (const [startPoint, endPoint, label] of [
        [{ x: 36, y: 36 }, { x: 48, y: 132 }, { x: 96, y: 72 }],
        [{ x: NaN, y: 36 }, { x: 36, y: 132 }, { x: 96, y: 72 }],
        [{ x: 36, y: 48 }, { x: 36, y: 132 }, { x: 96, y: 72 }],
        [{ x: 36, y: 12 }, { x: 36, y: 132 }, { x: 96, y: 72 }],
        [{ x: 36, y: 36 }, { x: 36, y: 132 }, { x: 12, y: 12 }],
      ]) {
        spy.mockResolvedValueOnce({ id: 'root', width: 240, height: 240,
          children: [{ id: 'n0', x: 12, y: 12 }, { id: 'n1', x: 12, y: 132 }],
          edges: [{ id: 'e0', sources: ['n0'], targets: ['n1'], sections: [{ id: 's', startPoint, endPoint }], labels: [label] }] });
        await expect(layoutDiagram(input)).rejects.toMatchObject({ kind: 'layout' });
      }
    } finally { spy.mockRestore(); }
  });

  it('rejects output extent and area limits and wraps ELK failures', async () => {
    const spy = vi.spyOn(ELK.prototype, 'layout');
    try {
      for (const [width, height] of [[1201, 10], [10, 12001], [1100, 2000]]) {
        spy.mockResolvedValueOnce({ id: 'root', width: width * 12, height: height * 12, children: [{ id: 'n0', x: 12, y: 12 }], edges: [] });
        await expect(layoutDiagram({ nodes: [node('a')], edges: [] })).rejects.toMatchObject({ kind: 'oversize' });
      }
      spy.mockRejectedValueOnce(new Error('engine failed'));
      await expect(layoutDiagram({ nodes: [node('a')], edges: [] })).rejects.toEqual(new DiagramLayoutError('layout', 'Local diagram layout failed: engine failed'));
    } finally { spy.mockRestore(); }
  });
});
