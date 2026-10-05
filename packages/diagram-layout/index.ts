import ELKModule from 'elkjs/lib/elk.bundled.js';
import type { ELK as ElkApi, ELKConstructorArguments, ElkNode } from 'elkjs/lib/elk-api.js';
import type { DiagramParams, DiagramLayout, DiagramNode, DiagramPoint } from '../core/diagram.js';

export type DiagramErrorKind = 'invalid' | 'oversize' | 'layout';
export class DiagramLayoutError extends Error {
  constructor(public readonly kind: DiagramErrorKind, message: string) {
    super(message);
    this.name = 'DiagramLayoutError';
  }
}

export const DIAGRAM_LIMITS = Object.freeze({ nodes: 300, edges: 1500, width: 1200,
  height: 12000, area: 2_000_000, points: 100_000 });
// The bundled CommonJS constructor's declaration is interpreted as a namespace
// under NodeNext. Adapt the published constructor type without changing runtime interop.
const ELK = ELKModule as unknown as { new(args?: ELKConstructorArguments): ElkApi };
const SCALE = 12;
function invalid(message: string): never { throw new DiagramLayoutError('invalid', message); }
function oversize(message: string): never { throw new DiagramLayoutError('oversize', message); }
function failed(message: string): never { throw new DiagramLayoutError('layout', message); }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/u.test(v);

/** Approximation only when the caller omits its authoritative terminal measurement. */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (/\p{Mark}/u.test(char) || char === '\u200d' || char === '\ufe0f') continue;
    const cp = char.codePointAt(0)!;
    width += cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) ? 2 : 1;
  }
  return width;
}

function validateParams(value: unknown): asserts value is DiagramParams {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) invalid('Expected nodes and edges arrays');
  if (value.nodes.length > DIAGRAM_LIMITS.nodes || value.edges.length > DIAGRAM_LIMITS.edges)
    oversize(`Diagram supports at most ${DIAGRAM_LIMITS.nodes} nodes and ${DIAGRAM_LIMITS.edges} edges`);
  const nodes = new Set<string>();
  for (const node of value.nodes) {
    if (!record(node) || !identifier(node.id)) invalid('Each node needs a nonempty ID of at most 256 characters');
    if (nodes.has(node.id)) invalid(`Duplicate node ID: ${node.id}`);
    if (!integer(node.width, 6, 160) || !integer(node.height, 3, 30)) invalid(`Node ${node.id} dimensions must be integer cells: width 6..160, height 3..30`);
    nodes.add(node.id);
  }
  const edges = new Set<string>();
  for (const edge of value.edges) {
    if (!record(edge) || !identifier(edge.id) || !identifier(edge.from) || !identifier(edge.to)) invalid('Each edge needs valid id, from and to IDs');
    if (edges.has(edge.id)) invalid(`Duplicate edge ID: ${edge.id}`);
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) invalid(`Edge ${edge.id} references an unknown node`);
    if (edge.label !== undefined && (typeof edge.label !== 'string' || edge.label.length > 1024 || /[\x00-\x1f\x7f]/u.test(edge.label))) invalid(`Edge ${edge.id} label must be single-line text of at most 1024 UTF-16 units`);
    if (edge.labelWidth !== undefined && (!integer(edge.labelWidth, 0, 120) || edge.label === undefined)) invalid(`Edge ${edge.id} labelWidth must be 0..120 cells and have a label`);
    if (typeof edge.label === 'string' && (edge.labelWidth ?? displayWidth(edge.label)) > 120) oversize(`Edge ${edge.id} label exceeds 120 cells`);
    edges.add(edge.id);
  }
}

export function isDiagramParams(value: unknown): value is DiagramParams {
  try { validateParams(value); return true; } catch { return false; }
}

interface Rect { x: number; y: number; width: number; height: number }
function overlaps(a: Rect, b: Rect): boolean {
  return a.width > 0 && b.width > 0 && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function border(p: DiagramPoint, n: DiagramNode): boolean {
  return p.x >= n.x && p.x < n.x + n.width && p.y >= n.y && p.y < n.y + n.height &&
    (p.x === n.x || p.x === n.x + n.width - 1 || p.y === n.y || p.y === n.y + n.height - 1);
}
function crossesInterior(a: DiagramPoint, b: DiagramPoint, n: DiagramNode): boolean {
  const right = n.x + n.width - 1, bottom = n.y + n.height - 1;
  return a.x === b.x ? a.x > n.x && a.x < right && Math.max(a.y, b.y) > n.y && Math.min(a.y, b.y) < bottom :
    a.y > n.y && a.y < bottom && Math.max(a.x, b.x) > n.x && Math.min(a.x, b.x) < right;
}

/** Checks the final rounded cell geometry, never just ELK's floating-point geometry. */
function validateGeometry(layout: DiagramLayout): void {
  if (!integer(layout.width, 1, DIAGRAM_LIMITS.width) || !integer(layout.height, 1, DIAGRAM_LIMITS.height) ||
    layout.width * layout.height > DIAGRAM_LIMITS.area) oversize('Layout exceeds 1200x12000 cells or 2 million total cells');
  const rects: Rect[] = [...layout.nodes];
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  let count = 0;
  for (const edge of layout.edges) {
    if (edge.label) rects.push({ ...edge.label, height: 1 });
    count += edge.points.length;
    if (count > DIAGRAM_LIMITS.points) oversize('Layout exceeds 100000 route points');
    if (edge.points.length < 2 || !border(edge.points[0], nodes.get(edge.from)!) ||
      !border(edge.points[edge.points.length - 1], nodes.get(edge.to)!)) failed(`Edge ${edge.id} does not attach to node borders`);
    for (let i = 0; i < edge.points.length; i++) {
      const p = edge.points[i];
      if (!integer(p.x, 0, layout.width - 1) || !integer(p.y, 0, layout.height - 1)) failed(`Edge ${edge.id} has an invalid cell coordinate`);
      if (i === 0) continue;
      const previous = edge.points[i - 1];
      if (p.x !== previous.x && p.y !== previous.y) failed(`Edge ${edge.id} has a nonorthogonal segment`);
      for (const node of layout.nodes) if (crossesInterior(previous, p, node)) failed(`Edge ${edge.id} crosses node ${node.id} interior`);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    if (!integer(a.x, 0, layout.width - 1) || !integer(a.y, 0, layout.height - 1) ||
      !integer(a.width, 0, layout.width) || !integer(a.height, 1, layout.height) ||
      a.x + a.width > layout.width || a.y + a.height > layout.height) failed('Layout contains an invalid rectangle');
    for (let j = 0; j < i; j++) if (overlaps(a, rects[j])) failed('Rounded layout contains overlapping node boxes or labels');
  }
}

const compare = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const cell = (v: number | undefined): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) failed('ELK returned a missing or nonfinite coordinate');
  return Math.round(v / SCALE);
};

export async function layoutDiagram(params: DiagramParams): Promise<DiagramLayout> {
  const start = performance.now();
  validateParams(params);
  if (params.nodes.length === 0) return { schemaVersion: 1, width: 1, height: 1, nodes: [], edges: [], elapsedMs: performance.now() - start };
  const inputs = params.nodes.map(node => ({ id: node.id, width: node.width, height: node.height })).sort(compare);
  const edges = params.edges.map(edge => ({ id: edge.id, from: edge.from, to: edge.to, label: edge.label, labelWidth: edge.labelWidth })).sort(compare);
  const ids = new Map(inputs.map((node, index) => [node.id, `n${index}`]));
  // Internal IDs keep arbitrary user IDs out of ELK's compound-node namespaces.
  let elk: ElkApi | undefined;
  try {
    elk = new ELK({ algorithms: ['layered'] });
    const graph = await elk.layout<ElkNode>({ id: 'root', layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '1', 'elk.padding': `[top=${3 * SCALE},left=${3 * SCALE},bottom=${3 * SCALE},right=${3 * SCALE}]`,
      'elk.spacing.nodeNode': String(5 * SCALE), 'elk.spacing.edgeNode': String(3 * SCALE),
      'elk.spacing.edgeEdge': String(2 * SCALE), 'elk.spacing.labelNode': String(2 * SCALE),
      'elk.spacing.edgeLabel': String(SCALE), 'elk.layered.spacing.nodeNodeBetweenLayers': String(6 * SCALE),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(3 * SCALE),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(2 * SCALE),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.mergeEdges': 'false', 'elk.layered.unnecessaryBendpoints': 'true',
    }, children: inputs.map(node => ({ id: ids.get(node.id)!, width: (node.width - 1) * SCALE, height: (node.height - 1) * SCALE })),
    edges: edges.map((edge, i) => ({ id: `e${i}`, sources: [ids.get(edge.from)!], targets: [ids.get(edge.to)!],
      labels: edge.label === undefined ? [] : [{ id: `l${i}`, text: edge.label,
        width: Math.max(1, edge.labelWidth ?? displayWidth(edge.label)) * SCALE, height: SCALE,
        layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }],
    })) });
    const children = new Map((graph.children ?? []).map(node => [node.id, node]));
    const routed = new Map((graph.edges ?? []).map(edge => [edge.id, edge]));
    if (children.size !== inputs.length || routed.size !== edges.length) failed('ELK did not preserve every node and edge');
    const nodes = inputs.map(node => {
      const placed = children.get(ids.get(node.id)!);
      if (!placed) failed(`ELK omitted node ${node.id}`);
      return { id: node.id, width: node.width, height: node.height, x: cell(placed.x), y: cell(placed.y) };
    });
    const outputEdges = edges.map((edge, i) => {
      const placed = routed.get(`e${i}`);
      if (!placed || placed.sections?.length !== 1) failed(`ELK returned unsupported routing for edge ${edge.id}`);
      const section = placed.sections[0];
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(p => ({ x: cell(p.x), y: cell(p.y) }))
        .filter((p, j, all) => j === 0 || p.x !== all[j - 1].x || p.y !== all[j - 1].y);
      const label = placed.labels?.[0];
      if (edge.label !== undefined && !label) failed(`ELK omitted label on edge ${edge.id}`);
      return { id: edge.id, from: edge.from, to: edge.to, points,
        ...(edge.label === undefined ? {} : { label: { text: edge.label, x: cell(label!.x), y: cell(label!.y), width: edge.labelWidth ?? displayWidth(edge.label) } }) };
    });
    const layout: DiagramLayout = { schemaVersion: 1, width: cell(graph.width) + 1, height: cell(graph.height) + 1,
      nodes, edges: outputEdges, elapsedMs: performance.now() - start };
    validateGeometry(layout);
    return layout;
  } catch (cause) {
    if (cause instanceof DiagramLayoutError) throw cause;
    throw new DiagramLayoutError('layout', `Local diagram layout failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    // ELK's bundled in-process worker shim has no terminate() method. Calling
    // terminateWorker() on it masks both successful geometry and typed failures.
    // Only a real worker transport requires termination (ELK wraps it once).
    const transport = (elk as unknown as { worker?: { worker?: { terminate?: unknown } } } | undefined)?.worker?.worker;
    if (typeof transport?.terminate === 'function') elk?.terminateWorker();
  }
}
