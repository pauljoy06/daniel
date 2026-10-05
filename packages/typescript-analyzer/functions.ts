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
  if (name === '<anonymous>') {
    let parent: ts.Node = node.parent;
    while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      const context = ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isIdentifier(callee) ? callee.text : undefined;
      if (context) name = `${context} callback`;
    }
  }
  return { id: `${source.file}:${source.startLine}:${source.startColumn}`, name, source,
    async: !!node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) };
}

export function containingFunction(file: ts.SourceFile, line: number, column: number, depth = 0): ExecutableFunction {
  if (!Number.isInteger(depth) || depth < 0 || depth > 64) throw new Error('Function depth must be an integer from 0 to 64');
  const lines = file.getLineStarts();
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length) {
    throw new Error('Cursor line and column must be valid one-based integer positions');
  }
  const start = lines[line - 1];
  let lineEnd = line < lines.length ? lines[line] : file.text.length;
  // Line terminators are not cursor columns, and must not spill into the next line.
  while (lineEnd > start && /[\r\n\u2028\u2029]/.test(file.text[lineEnd - 1])) lineEnd--;
  if (start + column - 1 > lineEnd) throw new Error('Cursor column is outside the source line');
  const offset = start + column - 1;
  const containing: ExecutableFunction[] = [];
  function visit(node: ts.Node): void {
    if (offset < node.getStart(file) || offset >= node.getEnd()) return;
    if (isExecutableFunction(node) && node.body) containing.push(node);
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(file, visit);
  if (!containing.length) throw new Error('Cursor is not inside a function with an implementation');
  const result = containing[containing.length - 1 - depth];
  if (!result) throw new Error(`No enclosing function at depth ${depth}; maximum is ${containing.length - 1}`);
  return result;
}
