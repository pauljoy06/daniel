import ts from 'typescript';
import path from 'node:path';
import type { FunctionInfo, SourceLocation } from '../core/model.js';

export type ExecutableFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction
  | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration;

export function isExecutableFunction(node: ts.Node): node is ExecutableFunction {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node);
}

export function location(node: ts.Node, endNode: ts.Node = node): SourceLocation {
  const file = node.getSourceFile();
  const start = file.getLineAndCharacterOfPosition(node.getStart(file));
  const end = file.getLineAndCharacterOfPosition(endNode.getEnd());
  return { file: path.resolve(file.fileName), startLine: start.line + 1, startColumn: start.character + 1,
    endLine: end.line + 1, endColumn: end.character + 1 };
}

export function functionInfo(node: ExecutableFunction): FunctionInfo {
  const source = location(node);
  let name = node.name?.getText() ?? (ts.isConstructorDeclaration(node) ? 'constructor' : '<anonymous>');
  if (!node.name && ts.isVariableDeclaration(node.parent)) name = node.parent.name.getText();
  if (!node.name && ts.isPropertyAssignment(node.parent)) name = node.parent.name.getText();
  return { id: `${source.file}:${source.startLine}:${source.startColumn}`, name, source,
    async: !!node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) };
}

export function containingFunction(file: ts.SourceFile, line: number, column: number): ExecutableFunction {
  const lines = file.getLineStarts();
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length) {
    throw new Error('Cursor line and column must be valid one-based integer positions');
  }
  const start = lines[line - 1];
  const lineEnd = line < lines.length ? lines[line] : file.text.length;
  if (start + column - 1 > lineEnd) throw new Error('Cursor column is outside the source line');
  const offset = start + column - 1;
  let result: ExecutableFunction | undefined;
  function visit(node: ts.Node): void {
    if (offset < node.getStart(file) || offset >= node.getEnd()) return;
    if (isExecutableFunction(node) && node.body) result = node;
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(file, visit);
  if (!result) throw new Error('Cursor is not inside a function with an implementation');
  return result;
}
