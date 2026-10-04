import type { ExecutionModel } from '../core/model.js';

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;')
    .replace(/[\r\n]+/g, '<br/>');
}

export function toMermaid(model: ExecutionModel): string {
  const lines = ['flowchart TD'];
  const ids = new Map(model.nodes.map((n, i) => [n.id, `N${i + 1}`]));
  for (const node of model.nodes) {
    const call = model.calls.find(c => c.nodeId === node.id);
    const label = escape(node.label + (call && call.resolution !== 'resolved' ? ` [${call.resolution}]` : ''));
    const shape = node.kind === 'condition' || node.kind === 'loop' ? `{"${label}"}` : `["${label}"]`;
    lines.push(`  ${ids.get(node.id)}${shape}`);
  }
  for (const edge of model.edges) {
    const label = escape(edge.label ?? edge.type);
    lines.push(`  ${ids.get(edge.from)} ${edge.type === 'exception' ? '-.' : '--'}->|"${label}"| ${ids.get(edge.to)}`);
  }
  return lines.join('\n') + '\n';
}
