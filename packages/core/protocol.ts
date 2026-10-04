import type { AnalyzeParams } from './model.js';

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export function isRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return request.jsonrpc === '2.0' && typeof request.method === 'string'
    && (!('id' in request) || request.id === null || typeof request.id === 'string' || typeof request.id === 'number');
}

export function isAnalyzeParams(value: unknown): value is AnalyzeParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const params = value as Record<string, unknown>;
  return typeof params.file === 'string' && params.file.length > 0
    && Number.isInteger(params.line) && Number.isInteger(params.column)
    && Number(params.line) > 0 && Number(params.column) > 0
    && (params.tsconfig === undefined || typeof params.tsconfig === 'string')
    && (params.sourceText === undefined || typeof params.sourceText === 'string');
}
