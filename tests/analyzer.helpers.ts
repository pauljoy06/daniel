import { analyze } from '../packages/typescript-analyzer/index.js';
import type { ExecutionEdge, ExecutionModel, ExecutionNode } from '../packages/core/model.js';

export const fixtureFile = new URL('../fixtures/example.ts', import.meta.url).pathname;

export function modelFor(body: string, options: { file?: string; prefix?: string; suffix?: string } = {}): ExecutionModel {
  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? '';
  const sourceText = `${prefix}function main(){   ${body}}${suffix}`;
  const mainOffset = prefix.split('\n').length - 1;
  return analyze({ file: options.file ?? fixtureFile, line: mainOffset + 1, column: 20, sourceText });
}

export function node(model: ExecutionModel, text: string, kind?: ExecutionNode['kind']): ExecutionNode {
  const found = model.nodes.filter((candidate) => candidate.label.includes(text) && (!kind || candidate.kind === kind))
    .sort((a, b) => a.label.length - b.label.length)[0];
  if (!found) throw new Error(`missing node containing ${JSON.stringify(text)}; labels: ${model.nodes.map((n) => n.label).join(' | ')}`);
  return found;
}

/** Traverse modeled control flow, not conservative implicit exception edges. */
export function reaches(model: ExecutionModel, from: string, to: string, forbidden: Set<string> = new Set()): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.pop()!;
    if (forbidden.has(id) || seen.has(id)) continue;
    if (id === to) return true;
    seen.add(id);
    queue.push(...model.edges.filter(e => e.from === id && e.type !== 'exception').map(e => e.to));
  }
  return false;
}

export function edge(model: ExecutionModel, from: ExecutionNode, to: ExecutionNode, type?: ExecutionEdge['type']): ExecutionEdge | undefined {
  return model.edges.find((candidate) => candidate.from === from.id && candidate.to === to.id && (!type || candidate.type === type));
}

export function successors(model: ExecutionModel, from: ExecutionNode, type?: ExecutionEdge['type']): ExecutionNode[] {
  const ids = model.edges.filter((candidate) => candidate.from === from.id && (!type || candidate.type === type)).map((candidate) => candidate.to);
  return model.nodes.filter((candidate) => ids.includes(candidate.id));
}

export function assertClosedGraph(model: ExecutionModel): void {
  const ids = new Set(model.nodes.map((candidate) => candidate.id));
  for (const candidate of model.edges) {
    if (!ids.has(candidate.from) || !ids.has(candidate.to)) throw new Error(`dangling edge ${candidate.id}`);
  }
  if (!ids.has(model.entryNodeId) || !ids.has(model.exitNodeId)) throw new Error('entry or exit missing');
}
