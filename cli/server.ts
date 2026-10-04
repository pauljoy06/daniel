import { createInterface } from 'node:readline';
import { analyze } from '../packages/typescript-analyzer/index.js';
import { toMermaid } from '../packages/mermaid-renderer/index.js';
import { isRequest, isAnalyzeParams } from '../packages/core/protocol.js';

/** JSON-RPC 2.0, one UTF-8 JSON value per line. Stdout is exclusively protocol data. */
export function serve(): void {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (response: unknown): void => { process.stdout.write(JSON.stringify(response) + '\n'); };
  const error = (id: unknown, code: number, message: string): void => send({ jsonrpc: '2.0', id, error: { code, message } });
  input.on('line', line => {
    let request: unknown;
    try { request = JSON.parse(line); }
    catch { error(null, -32700, 'Parse error'); return; }
    if (!isRequest(request)) { error(null, -32600, 'Invalid request'); return; }
    const hasId = Object.prototype.hasOwnProperty.call(request, 'id');
    const fail = (code: number, message: string): void => { if (hasId) error(request.id, code, message); };
    if (request.method !== 'analyze' && request.method !== 'exportMermaid') {
      fail(-32601, 'Method not found'); return;
    }
    if (!isAnalyzeParams(request.params)) { fail(-32602, 'Invalid analysis parameters'); return; }
    try {
      const model = analyze(request.params);
      if (hasId) send({ jsonrpc: '2.0', id: request.id,
        result: request.method === 'exportMermaid' ? toMermaid(model) : model });
    } catch (cause) {
      fail(-32001, cause instanceof Error ? cause.message : 'Analysis failed');
    }
  });
}
