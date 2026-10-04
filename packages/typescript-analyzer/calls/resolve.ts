import ts from 'typescript';
import type { CallSite } from '../../core/model.js';
import { functionInfo, isExecutableFunction, location } from '../functions.js';

export function resolveCall(checker: ts.TypeChecker, call: ts.CallExpression | ts.NewExpression,
  nodeId: string): CallSite {
  const result: CallSite = { id: `call_${nodeId}`, nodeId, name: call.expression.getText(),
    source: location(call), resolution: 'unresolved' };
  if (ts.isElementAccessExpression(call.expression)) {
    result.reason = 'Dynamic element access is not resolved to a fabricated target';
    return result;
  }
  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name : call.expression);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declarations = symbol?.getDeclarations() ?? [];
  const candidates = declarations.flatMap(declaration => {
    if (isExecutableFunction(declaration) && declaration.body) return [declaration];
    if ((ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)
      || ts.isPropertyAssignment(declaration)) && declaration.initializer
      && isExecutableFunction(declaration.initializer)) return [declaration.initializer];
    if (ts.isClassDeclaration(declaration) && ts.isNewExpression(call)) {
      return declaration.members.filter(ts.isConstructorDeclaration).filter(c => !!c.body);
    }
    return [];
  });
  // Method dispatch may be overridden at runtime. A declaration alone is not a runtime target.
  if (ts.isPropertyAccessExpression(call.expression)
      && !ts.isIdentifier(call.expression.expression)) {
    result.reason = 'Runtime receiver dispatch is not statically unique';
    return result;
  }
  if (candidates.length === 1) {
    if (ts.isMethodDeclaration(candidates[0]) && !candidates[0].modifiers?.some(m =>
      m.kind === ts.SyntaxKind.StaticKeyword) && ts.isPropertyAccessExpression(call.expression)) {
      const receiver = checker.getSymbolAtLocation(call.expression.expression);
      const isObjectLiteral = receiver?.valueDeclaration && ts.isVariableDeclaration(receiver.valueDeclaration)
        && receiver.valueDeclaration.initializer && ts.isObjectLiteralExpression(receiver.valueDeclaration.initializer)
        && !!(receiver.valueDeclaration.parent.flags & ts.NodeFlags.Const);
      if (!isObjectLiteral) {
        result.reason = 'Instance method declaration is known, but runtime dispatch can vary';
        return result;
      }
    }
    result.resolution = 'resolved';
    result.target = functionInfo(candidates[0]);
  } else if (declarations.length && declarations.every(d => d.getSourceFile().isDeclarationFile)) {
    result.resolution = 'external';
    result.reason = 'Only type declarations are available, not an implementation';
  } else {
    result.reason = candidates.length > 1 ? 'Multiple possible implementations' : 'No statically unique implementation';
  }
  return result;
}
