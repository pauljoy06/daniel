/** All positions are one-based UTF-16 columns, with an exclusive end. */
export interface SourceLocation {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface FunctionInfo {
  id: string;
  name: string;
  source: SourceLocation;
  async: boolean;
}

export type NodeKind = 'entry' | 'exit' | 'basicBlock' | 'condition' | 'call'
  | 'return' | 'loop' | 'throw' | 'break' | 'continue' | 'unsupported';

export interface ExecutionNode {
  id: string;
  kind: NodeKind;
  label: string;
  astKind: string;
  source: SourceLocation;
  statements?: SourceLocation[];
  callSiteId?: string;
  synthetic?: boolean;
  detail?: string;
}

export type EdgeKind = 'next' | 'true' | 'false' | 'case' | 'default' | 'back'
  | 'break' | 'continue' | 'return' | 'throw' | 'exception' | 'finally';

export interface ExecutionEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeKind;
  label?: string;
}

export interface CallSite {
  id: string;
  nodeId: string;
  name: string;
  source: SourceLocation;
  resolution: 'resolved' | 'external' | 'unresolved';
  target?: FunctionInfo;
  reason?: string;
}

export interface AnalysisDiagnostic {
  code: string;
  message: string;
  source: SourceLocation;
}

export interface ExecutionModel {
  schemaVersion: 1;
  entryFunction: FunctionInfo;
  entryNodeId: string;
  exitNodeId: string;
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  calls: CallSite[];
  diagnostics: AnalysisDiagnostic[];
}

export interface AnalyzeParams {
  file: string;
  line: number;
  column: number;
  tsconfig?: string;
  /** An in-memory override for the cursor's file. Disk is never modified. */
  sourceText?: string;
}
