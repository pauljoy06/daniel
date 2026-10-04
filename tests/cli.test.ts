import { describe, expect, it } from 'vitest';
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { toMermaid } from '../packages/mermaid-renderer/index.js';
import { analyze } from '../packages/typescript-analyzer/index.js';

const cli = path.resolve('dist/cli/index.js');
const file = path.resolve('fixtures/conditions/branches.ts');
const params = { file, line: 5, column: 3 };

describe('built CLI', () => {
  it('prints a model for a real on-disk function', () => {
    const run = spawnSync(process.execPath, [cli, 'analyze', `${file}:5:3`], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const model = JSON.parse(run.stdout);
    expect(model.schemaVersion).toBe(1);
    expect(model.entryFunction.name).toBe('saveOrder');
    expect(model.nodes.some((n: { kind: string }) => n.kind === 'condition')).toBe(true);
  });

  it('rejects invalid arguments without writing protocol data', () => {
    const run = spawnSync(process.execPath, [cli, 'analyze', 'bad'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('Expected a source position');
  });

  it('supports Mermaid from the same execution model', () => {
    const run = spawnSync(process.execPath, [cli, 'analyze', `${file}:5:3`, '--mermaid'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe(toMermaid(analyze(params)));
  });
});

describe('newline-framed JSON-RPC', () => {
  it('handles parse errors, bad methods, bad params, notifications, and null IDs', () => {
    const messages = [
      '{bad json',
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'missing' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'analyze', params: { file } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'analyze', params }),
      JSON.stringify({ jsonrpc: '2.0', id: null, method: 'analyze', params }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'exportMermaid', params }),
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'analyze', params: { ...params, sourceText: 'function {' } }),
      JSON.stringify([]),
    ];
    const run = spawnSync(process.execPath, [cli, 'serve'], { encoding: 'utf8',
      input: messages.join('\n') + '\n', timeout: 30000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe('');
    const replies = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(replies).toHaveLength(7);
    expect(replies[0].error.code).toBe(-32700);
    expect(replies[1].error.code).toBe(-32601);
    expect(replies[2].error.code).toBe(-32602);
    expect(replies[3].id).toBe(null);
    expect(replies[3].result.entryFunction.name).toBe('saveOrder');
    expect(replies[4].result).toContain('flowchart TD');
    expect(replies[5].error.code).toBe(-32001);
    expect(replies[6].error.code).toBe(-32600);
  });

  it('accepts a request fragmented across stdin writes with unsaved contents', async () => {
    const child = spawn(process.execPath, [cli, 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const finished = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    const request = JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'analyze', params: {
      file, line: 1, column: 20, sourceText: 'function unsaved() { return 42; }',
    } });
    child.stdin.write(request.slice(0, 13));
    child.stdin.end(request.slice(13) + '\n');
    expect(await finished, errors).toBe(0);
    expect(JSON.parse(output).result.entryFunction.name).toBe('unsaved');
  });
});
