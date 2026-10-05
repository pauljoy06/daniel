import { createInterface } from 'node:readline';
import { analyze } from '../packages/typescript-analyzer/index.js';
import { toMermaid } from '../packages/mermaid-renderer/index.js';
import { isRequest, isAnalyzeParams } from '../packages/core/protocol.js';
import { layoutDiagram, DiagramLayoutError } from '../packages/diagram-layout/index.js';
import type { DiagramParams } from '../packages/core/diagram.js';

/** JSON-RPC 2.0, one UTF-8 JSON value per line. Stdout is exclusively protocol data.
 * Requests are serialized so EOF drains outstanding layouts and response order stays stable.
 */
export function serve(): void {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const send = (response: unknown): void => { process.stdout.write(JSON.stringify(response) + '\n'); };
  const error = (id: unknown, code: number, message: string): void => send({ jsonrpc: '2.0', id, error: { code, message } });
  const handle = async (line: string): Promise<void> => {
    let request: unknown;
    if (line.length > 2_000_000) { error(null, -32600, 'Request exceeds 2 million characters'); return; }
    try { request = JSON.parse(line); }
    catch { error(null, -32700, 'Parse error'); return; }
    if (!isRequest(request)) { error(null, -32600, 'Invalid request'); return; }
    const hasId = Object.prototype.hasOwnProperty.call(request, 'id');
    const fail = (code: number, message: string): void => { if (hasId) error(request.id, code, message); };
    if (request.method !== 'analyze' && request.method !== 'exportMermaid' && request.method !== 'layout') {
      fail(-32601, 'Method not found'); return;
    }
    try {
      let result: unknown;
      if (request.method === 'layout') {
        // layoutDiagram validates unknown input itself, retaining useful typed error messages.
        result = await layoutDiagram(request.params as DiagramParams);
      } else {
        if (!isAnalyzeParams(request.params)) { fail(-32602, 'Invalid analysis parameters'); return; }
        const model = analyze(request.params);
        result = request.method === 'exportMermaid' ? toMermaid(model) : model;
      }
      if (hasId) send({ jsonrpc: '2.0', id: request.id, result });
    } catch (cause) {
      const code = cause instanceof DiagramLayoutError ?
        (cause.kind === 'invalid' ? -32602 : cause.kind === 'oversize' ? -32002 : -32003) : -32001;
      fail(code, cause instanceof Error ? cause.message : 'Request failed');
    }
  };
  let pending = Promise.resolve();
  let closed = false;
  input.on('line', line => {
    // Pause the stream while ELK works. Already-buffered lines still join the same queue.
    input.pause();
    pending = pending.then(() => handle(line)).finally(() => { if (!closed) input.resume(); });
  });
  input.on('close', () => {
    closed = true;
    // Do not call process.exit at EOF: async layouts and stdout writes must finish first.
    void pending.catch(cause => { process.stderr.write(`RPC stream failed: ${String(cause)}\n`); process.exitCode = 1; });
  });
}
