import { describe, expect, it } from 'vitest';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toMermaid } from '../packages/mermaid-renderer/index.js';
import { analyze } from '../packages/typescript-analyzer/index.js';

const cli = path.resolve('bin/daniel');
const file = path.resolve('fixtures/conditions/branches.ts');
const params = { file, line: 5, column: 3 };

describe('built CLI', () => {
  it('runs the executable directly and advertises Daniel commands', () => {
    const run = spawnSync(cli, ['--help'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('Daniel: deterministic TypeScript control flow');
    expect(run.stdout).toContain('daniel analyze');
    expect(run.stdout).toContain('daniel serve');
    expect(run.stdout).not.toMatch(/codeviz/i);
  });

  it('uses Daniel package, script, executable, and workspace names', () => {
    const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(metadata.name).toBe('daniel');
    expect(metadata.bin).toEqual({ daniel: 'bin/daniel' });
    expect(metadata.scripts.daniel).toBe('node dist/cli/index.js');
    expect(metadata.scripts).not.toHaveProperty('codeviz');
    for (const [directory, name] of [
      ['cli', '@daniel/cli'],
      ['packages/core', '@daniel/core'],
      ['packages/typescript-analyzer', '@daniel/typescript-analyzer'],
      ['packages/mermaid-renderer', '@daniel/mermaid-renderer'],
    ]) {
      expect(JSON.parse(readFileSync(`${directory}/package.json`, 'utf8')).name).toBe(name);
    }
  });

  it('does not keep legacy executable or native plugin entry-point files', () => {
    for (const legacy of ['bin/codeviz', 'nvim/plugin/codeviz.lua', 'nvim/lua/codeviz/init.lua', 'nvim/doc/codeviz.txt']) {
      expect(existsSync(legacy), `legacy entry point remains: ${legacy}`).toBe(false);
    }
  });

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
  it('lays out built RPC requests, drains EOF, ignores notifications and reports parameter errors', () => {
    const diagram = { nodes: [{ id: 'a', width: 12, height: 5 }, { id: 'b', width: 12, height: 5 }],
      edges: [{ id: 'one', from: 'a', to: 'b', label: '界', labelWidth: 2 },
        { id: 'two', from: 'a', to: 'b' }, { id: 'loop', from: 'b', to: 'b' }] };
    const messages = [
      { jsonrpc: '2.0', id: 10, method: 'layout', params: diagram },
      { jsonrpc: '2.0', method: 'layout', params: diagram },
      { jsonrpc: '2.0', method: 'layout', params: null },
      { jsonrpc: '2.0', id: 11, method: 'layout', params: { nodes: [], edges: [{ id: 'bad', from: 'a', to: 'b' }] } },
      { jsonrpc: '2.0', id: 12, method: 'layout', params: { nodes: Array.from({ length: 301 }, (_, i) => ({ id: `n${i}`, width: 6, height: 3 })), edges: [] } },
      { jsonrpc: '2.0', id: 13, method: 'analyze', params },
      { jsonrpc: '2.0', id: 14, method: 'layout', params: diagram },
    ];
    const run = spawnSync(process.execPath, [cli, 'serve'], { encoding: 'utf8',
      input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', timeout: 30000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toBe('');
    const replies = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(replies.map(reply => reply.id)).toEqual([10, 11, 12, 13, 14]);
    const layout = replies[0].result;
    expect(layout.schemaVersion).toBe(1);
    expect(layout.nodes.map((node: { id: string }) => node.id).sort()).toEqual(['a', 'b']);
    expect(layout.edges.map((edge: { id: string }) => edge.id).sort()).toEqual(['loop', 'one', 'two']);
    expect(layout.edges.find((edge: { id: string }) => edge.id === 'one').label).toMatchObject({ text: '界', width: 2 });
    expect(replies[1].error).toMatchObject({ code: -32602, message: expect.stringContaining('unknown node') });
    expect(replies[2].error.code).toBe(-32002);
    expect(replies[3].result.entryFunction.name).toBe('saveOrder');
    const { elapsedMs: firstElapsed, ...first } = layout;
    const { elapsedMs: secondElapsed, ...second } = replies[4].result;
    expect(firstElapsed).toBeGreaterThanOrEqual(0);
    expect(secondElapsed).toBeGreaterThanOrEqual(0);
    expect(second).toEqual(first);
  });

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
