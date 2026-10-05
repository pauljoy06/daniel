/** Display-only geometry. Source semantics remain in ExecutionModel. All coordinates
 * are zero-based integer terminal cells. Node rectangles include their borders:
 * right = x + width - 1 and bottom = y + height - 1. Edge endpoints lie on borders.
 */
export interface DiagramNodeInput {
  id: string;
  width: number;
  height: number;
}
export interface DiagramEdgeInput {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** Display width measured by Neovim, not JavaScript string length. */
  labelWidth?: number;
}
export interface DiagramParams {
  nodes: DiagramNodeInput[];
  edges: DiagramEdgeInput[];
}
export interface DiagramPoint { x: number; y: number }
export interface DiagramNode extends DiagramNodeInput { x: number; y: number }
export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  points: DiagramPoint[];
  label?: { text: string; x: number; y: number; width: number };
}
export interface DiagramLayout {
  schemaVersion: 1;
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Locally measured, excluded from deterministic geometry comparisons. */
  elapsedMs: number;
}
