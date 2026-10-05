#!/usr/bin/env node
import { analyze } from '../packages/typescript-analyzer/index.js';
import { toMermaid } from '../packages/mermaid-renderer/index.js';
import { serve } from './server.js';

const usage = `Daniel: deterministic TypeScript control flow

  daniel analyze <file>:<line>:<column> [--tsconfig <path>] [--mermaid]
  daniel serve

Coordinates are one-based UTF-16. serve uses JSON-RPC 2.0 newline-delimited JSON.
`;

export function main(args = process.argv.slice(2)): void {
  if (!args.length || args[0] === '--help' || args[0] === '-h') { process.stdout.write(usage); return; }
  if (args[0] === 'serve') {
    if (args.length !== 1) throw new Error('serve does not accept arguments');
    serve(); return;
  }
  if (args[0] !== 'analyze' || !args[1]) throw new Error(usage);
  const match = /^(.*):(\d+):(\d+)$/.exec(args[1]);
  if (!match) throw new Error('Expected a source position: file.ts:line:column');
  let tsconfig: string | undefined;
  let mermaid = false;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--mermaid') mermaid = true;
    else if (args[i] === '--tsconfig' && args[i + 1]) tsconfig = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  const model = analyze({ file: match[1], line: Number(match[2]), column: Number(match[3]), tsconfig });
  process.stdout.write(mermaid ? toMermaid(model) : JSON.stringify(model, null, 2) + '\n');
}

try { main(); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
