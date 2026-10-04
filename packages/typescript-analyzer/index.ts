import type { AnalyzeParams, ExecutionModel } from '../core/model.js';
import { loadProject } from './project.js';
import { containingFunction } from './functions.js';
import { CfgBuilder } from './cfg/builder.js';

export function analyze(params: AnalyzeParams): ExecutionModel {
  if (!params || typeof params.file !== 'string' || !params.file
    || !Number.isInteger(params.line) || !Number.isInteger(params.column)
    || (params.sourceText !== undefined && typeof params.sourceText !== 'string')
    || (params.tsconfig !== undefined && typeof params.tsconfig !== 'string')) {
    throw new Error('Expected {file, line, column, sourceText?, tsconfig?}');
  }
  const { program, file } = loadProject(params);
  const fn = containingFunction(file, params.line, params.column);
  return new CfgBuilder(fn, program.getTypeChecker()).build();
}
