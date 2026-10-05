import type { AnalyzeParams, ExecutionModel } from '../core/model.js';
import { loadProject } from './project.js';
import { containingFunction } from './functions.js';
import { CfgBuilder } from './cfg/builder.js';

export function analyze(params: AnalyzeParams): ExecutionModel {
  if (!params || typeof params.file !== 'string' || !params.file
    || !Number.isInteger(params.line) || !Number.isInteger(params.column)
    || (params.sourceText !== undefined && typeof params.sourceText !== 'string')
    || (params.tsconfig !== undefined && typeof params.tsconfig !== 'string')
    || (params.functionDepth !== undefined && (!Number.isInteger(params.functionDepth)
      || params.functionDepth < 0 || params.functionDepth > 64))) {
    throw new Error('Expected {file, line, column, sourceText?, tsconfig?, functionDepth?: 0..64}');
  }
  const { program, file } = loadProject(params);
  const fn = containingFunction(file, params.line, params.column, params.functionDepth ?? 0);
  return new CfgBuilder(fn, program.getTypeChecker()).build();
}
