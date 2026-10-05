import { describe, expect, it } from 'vitest';
import { analyze } from '../packages/typescript-analyzer/index.js';
import { isAnalyzeParams } from '../packages/core/protocol.js';
import { fixtureFile } from './analyzer.helpers.js';

const sourceText = 'function outer(items: any[]){ return items.map(item => { return item.shipto || item.backup; }); }';
const params = { file: fixtureFile, line: 1, column: sourceText.indexOf('item.shipto') + 1, sourceText };

describe('visual flow analysis selection', () => {
  it('identifies a callback by its call context and selects its enclosing function explicitly', () => {
    const inner = analyze(params);
    expect(inner.entryFunction.name).toBe('map callback');
    expect(inner.entryFunction.source.startColumn).toBe(sourceText.indexOf('item =>') + 1);
    const outer = analyze({ ...params, functionDepth: 1 });
    expect(outer.entryFunction.name).toBe('outer');
    expect(outer.entryFunction.source.startColumn).toBe(1);
    expect(outer.calls.map(call => call.name)).toContain('items.map');
    expect(analyze({ ...params, functionDepth: 0 })).toEqual(inner);
  });

  it('does not replace the chosen function when an enclosing depth does not exist', () => {
    expect(() => analyze({ ...params, functionDepth: 2 })).toThrow(/No enclosing function at depth 2/);
    expect(analyze(params).entryFunction.name).toBe('map callback');
  });

  it.each([-1, 0.5, 65, NaN, Infinity, '1', null])('rejects invalid depth %s at both input boundaries', depth => {
    const candidate = { ...params, functionDepth: depth };
    expect(isAnalyzeParams(candidate)).toBe(false);
    expect(() => analyze(candidate as Parameters<typeof analyze>[0])).toThrow(/Expected/);
  });

  it('keeps optional chains explicitly uncertain instead of silently fixing semantics in the renderer', () => {
    const sourceText = 'function outer(items: any[]){ return items.map(item => ({ part: item?.part || null })); }';
    const model = analyze({ file: fixtureFile, line: 1, column: sourceText.indexOf('item?.part') + 1, sourceText });
    expect(model.entryFunction.name).toBe('map callback');
    expect(model.nodes.some(node => node.kind === 'unsupported')).toBe(true);
    expect(model.diagnostics.length).toBeGreaterThan(0);
  });
});
