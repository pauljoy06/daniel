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
  if (declarations.length && declarations.every(d => d.getSourceFile().isDeclarationFile)) {
    result.resolution = 'external';
    result.reason = 'Only type declarations are available, not an implementation';
    return result;
  }
  if (declarations.some(d => ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d))) {
    result.reason = 'Accessor result is not a statically unique callable implementation';
    return result;
  }
  if (declarations.some(d => ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent)
      && !(d.parent.flags & ts.NodeFlags.Const))) {
    result.reason = 'Mutable function binding has no guaranteed static implementation';
    return result;
  }
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
    const candidate = candidates[0];
    const declaration = ts.isPropertyDeclaration(candidate.parent) || ts.isPropertyAssignment(candidate.parent)
      ? candidate.parent : candidate;
    if (ts.isPropertyAccessExpression(call.expression)
      && (ts.isMethodDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration))) {
      const isStatic = (ts.isMethodDeclaration(declaration) || ts.isPropertyDeclaration(declaration))
        && declaration.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword);
      let receiver = checker.getSymbolAtLocation(call.expression.expression);
      if (receiver && receiver.flags & ts.SymbolFlags.Alias) receiver = checker.getAliasedSymbol(receiver);
      const isObjectLiteral = receiver?.valueDeclaration && ts.isVariableDeclaration(receiver.valueDeclaration)
        && receiver.valueDeclaration.initializer && ts.isObjectLiteralExpression(receiver.valueDeclaration.initializer)
        && !!(receiver.valueDeclaration.parent.flags & ts.NodeFlags.Const);
      if (!isStatic && !isObjectLiteral) {
        result.reason = 'Instance or mutable-object member is known, but runtime receiver dispatch can vary';
        return result;
      }
    }
    result.resolution = 'resolved';
    result.target = functionInfo(candidates[0]);
  } else {
    result.reason = candidates.length > 1 ? 'Multiple possible implementations' : 'No statically unique implementation';
  }
  return result;
}
