import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { analyze } from '../packages/typescript-analyzer/index.js';
import { modelFor } from './analyzer.helpers.js';

describe('conservative call target regressions', () => {
  it('does not confuse an accessor with the returned function being called', () => {
    const model = modelFor('const object = { get run() { return () => 1; } }; object.run();');
    expect(model.calls.find(call => call.name === 'object.run')).toMatchObject({ resolution: 'unresolved' });
  });

  it('does not resolve overridable instance arrow fields from the static receiver type', () => {
    const prefix = 'class Base { run = () => 1; } class Derived extends Base { run = () => 2; }\n';
    const model = modelFor('const value: Base = new Derived(); value.run();', { prefix });
    expect(model.calls.find(call => call.name === 'value.run')).toMatchObject({ resolution: 'unresolved' });
  });

  it('does not resolve function properties of a reassigned object binding', () => {
    const model = modelFor('let object = { run: () => 1 }; object = { run: () => 2 }; object.run();');
    expect(model.calls.find(call => call.name === 'object.run')).toMatchObject({ resolution: 'unresolved' });
  });

  it('retains statically known constant object function properties and static fields', () => {
    const model = modelFor('const object = { run: () => 1 }; object.run(); Service.run();', {
      prefix: 'class Service { static run = () => 2; }\n',
    });
    expect(model.calls.filter(call => call.resolution === 'resolved').map(call => call.name)).toEqual(['object.run', 'Service.run']);
  });
});

describe('configured project input regressions', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(process.env.JCODE_SCRATCH_DIR ?? tmpdir(), 'codeviz-reaudit-project-'));
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };

  it('analyzes an unsaved new file even when the configured include has no disk inputs', () => {
    write(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
    const model = analyze({ file: path.join(root, 'src/main.ts'), line: 1, column: 20,
      sourceText: 'function main(){   unsaved(); }' });
    expect(model.calls.map(call => call.name)).toEqual(['unsaved']);
  });

  it.each([false, true])('uses the cursor source and overlay through solution references (declarations: %s)', declarations => {
    const tsconfig = path.join(root, 'tsconfig.json');
    const file = path.join(root, 'lib/src/main.ts');
    write(tsconfig, JSON.stringify({ files: [], references: [{ path: './lib' }] }));
    write(path.join(root, 'lib/tsconfig.json'), JSON.stringify({ compilerOptions: {
      composite: true, declaration: true, outDir: 'dist', rootDir: 'src',
    }, include: ['src/**/*.ts'] }));
    write(file, 'export function main(){ diskOnly(); }');
    if (declarations) write(path.join(root, 'lib/dist/main.d.ts'), 'export declare function main(): void;');
    const model = analyze({ file, tsconfig, line: 1, column: 26,
      sourceText: 'export function main(){   unsaved(); }' });
    expect(model.entryFunction.name).toBe('main');
    expect(model.calls.map(call => call.name)).toEqual(['unsaved']);
  });

  it('classifies nested declaration-only namespace calls as external', () => {
    write(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      module: 'NodeNext', moduleResolution: 'NodeNext',
    }, include: ['*.ts'] }));
    write(path.join(root, 'types.d.ts'), 'export namespace api { function run(): void; }');
    const file = path.join(root, 'main.ts');
    const model = analyze({ file, line: 2, column: 20, sourceText:
      "import * as lib from './types.js';\nfunction main(){   lib.api.run(); }" });
    expect(model.calls.find(call => call.name === 'lib.api.run')).toMatchObject({ resolution: 'external' });
  });
});
