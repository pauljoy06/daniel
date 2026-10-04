import ts from 'typescript';
import type { ExecutionModel, EdgeKind, NodeKind } from '../../core/model.js';
import { functionInfo, isExecutableFunction, location, type ExecutableFunction } from '../functions.js';
import { resolveCall } from '../calls/resolve.js';

interface Context {
  returnTo: string;
  throwTo: string;
  breakTo?: string;
  continueTo?: string;
}

/** Continuation-passing construction keeps abrupt completions separate from fallthrough. */
export class CfgBuilder {
  private model: ExecutionModel;
  private serial = 0;

  constructor(private fn: ExecutableFunction, private checker: ts.TypeChecker) {
    this.model = { schemaVersion: 1, entryFunction: functionInfo(fn), entryNodeId: '', exitNodeId: '',
      nodes: [], edges: [], calls: [], diagnostics: [] };
  }

  build(): ExecutionModel {
    const entry = this.node('entry', this.fn, `Enter ${this.model.entryFunction.name}`, true);
    const exit = this.node('exit', this.fn, 'Exit', true);
    this.model.entryNodeId = entry;
    this.model.exitNodeId = exit;
    const context: Context = { returnTo: exit, throwTo: exit };
    const body = this.fn.body!;
    let first: string;
    if (ts.isBlock(body)) first = this.statements(body.statements, exit, context);
    else {
      const ret = this.node('return', body, `return ${body.getText()}`);
      this.edge(ret, exit, 'return');
      first = this.expression(body, ret, context);
    }
    if (this.fn.parameters.some(p => p.initializer || !ts.isIdentifier(p.name))) {
      first = this.unsupported(this.fn.parameters.find(p => p.initializer || !ts.isIdentifier(p.name))!, first, context,
        'Parameter defaults and destructuring evaluation are opaque in V1');
    }
    this.edge(entry, first);
    // Remove dead code constructed after an unconditional abrupt completion.
    const reachable = new Set<string>();
    const pending = [entry];
    const outgoing = new Map<string, string[]>();
    for (const edge of this.model.edges) {
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge.to);
      outgoing.set(edge.from, list);
    }
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...(outgoing.get(id) ?? []));
    }
    // Keep the declared exit even for provably infinite loops.
    reachable.add(exit);
    this.model.nodes = this.model.nodes.filter(n => reachable.has(n.id));
    this.model.edges = this.model.edges.filter(e => reachable.has(e.from) && reachable.has(e.to));
    this.model.calls = this.model.calls.filter(c => reachable.has(c.nodeId));
    const ordered: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      ordered.push(id);
      const edges = this.model.edges.filter(e => e.from === id);
      // Visit ordinary control flow before exceptional exits.
      edges.sort((a, b) => Number(a.type === 'exception') - Number(b.type === 'exception'));
      for (const edge of edges) visit(edge.to);
    };
    visit(entry);
    if (!seen.has(exit)) ordered.push(exit);
    const ranks = new Map(ordered.map((id, i) => [id, i]));
    this.model.nodes.sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
    this.model.calls.sort((a, b) => ranks.get(a.nodeId)! - ranks.get(b.nodeId)!);
    return this.model;
  }

  private node(kind: NodeKind, ast: ts.Node, label = ast.getText(), synthetic = false): string {
    const id = `n${++this.serial}`;
    this.model.nodes.push({ id, kind, label, astKind: ts.SyntaxKind[ast.kind], source: location(ast),
      ...(synthetic ? { synthetic: true } : {}) });
    return id;
  }

  private edge(from: string, to: string, type: EdgeKind = 'next', label?: string): void {
    this.model.edges.push({ id: `e${this.model.edges.length + 1}`, from, to, type,
      ...(label === undefined ? {} : { label }) });
  }

  private exceptional(id: string, ctx: Context): void {
    this.edge(id, ctx.throwTo, 'exception', 'may throw (conservative)');
  }

  private unsupported(ast: ts.Node, next: string, ctx: Context, message: string): string {
    const id = this.node('unsupported', ast, `Unsupported: ${ast.getText()}`);
    this.model.nodes.find(n => n.id === id)!.detail = message;
    this.model.diagnostics.push({ code: 'UNSUPPORTED', message, source: location(ast) });
    this.edge(id, next, 'next', 'opaque normal completion');
    this.exceptional(id, ctx);
    return id;
  }

  private requiresFlow(ast: ts.Node): boolean {
    if (isExecutableFunction(ast)) return false;
    if (ts.isVariableDeclaration(ast) && !ts.isIdentifier(ast.name)) return true;
    if (ts.isCallExpression(ast) || ts.isNewExpression(ast) || ts.isConditionalExpression(ast)
      || ts.isAwaitExpression(ast) || ts.isYieldExpression(ast) || ts.isTaggedTemplateExpression(ast)
      || ts.isSpreadElement(ast) || ts.isSpreadAssignment(ast)
      || !!(ast.flags & ts.NodeFlags.OptionalChain)) return true;
    if (ts.isBinaryExpression(ast) && this.lazyOperator(ast.operatorToken.kind)) return true;
    return !!ts.forEachChild(ast, child => this.requiresFlow(child) || undefined);
  }

  private lazyOperator(kind: ts.SyntaxKind): boolean {
    return [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken,
      ts.SyntaxKind.QuestionQuestionEqualsToken].includes(kind);
  }

  private canGroup(stmt: ts.Statement): boolean {
    return (ts.isVariableStatement(stmt) || ts.isExpressionStatement(stmt)
      || ts.isFunctionDeclaration(stmt) || ts.isEmptyStatement(stmt) || ts.isDebuggerStatement(stmt))
      && !this.requiresFlow(stmt)
      && !(ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Using));
  }

  private basic(statements: readonly ts.Statement[], next: string, ctx: Context): string {
    const first = statements[0];
    const id = this.node('basicBlock', first, statements.map(s => s.getText()).join('\n'));
    const node = this.model.nodes.find(n => n.id === id)!;
    node.source = location(first, statements[statements.length - 1]);
    node.statements = statements.map(s => location(s));
    this.edge(id, next);
    if (statements.some(s => !ts.isFunctionDeclaration(s) && !ts.isEmptyStatement(s))) this.exceptional(id, ctx);
    return id;
  }

  private statements(statements: readonly ts.Statement[], next: string, ctx: Context): string {
    let cursor = statements.length - 1;
    while (cursor >= 0) {
      if (this.canGroup(statements[cursor])) {
        const end = cursor;
        while (cursor >= 0 && this.canGroup(statements[cursor])) cursor--;
        next = this.basic(statements.slice(cursor + 1, end + 1), next, ctx);
      } else {
        next = this.statement(statements[cursor--], next, ctx);
      }
    }
    return next;
  }

  private statement(stmt: ts.Statement, next: string, ctx: Context): string {
    if (ts.isBlock(stmt)) return this.statements(stmt.statements, next, ctx);
    if (ts.isIfStatement(stmt)) {
      const yes = this.statement(stmt.thenStatement, next, ctx);
      const no = stmt.elseStatement ? this.statement(stmt.elseStatement, next, ctx) : next;
      return this.condition(stmt.expression, yes, no, ctx);
    }
    if (ts.isReturnStatement(stmt)) {
      const id = this.node('return', stmt);
      this.edge(id, ctx.returnTo, 'return');
      return stmt.expression ? this.expression(stmt.expression, id, ctx) : id;
    }
    if (ts.isThrowStatement(stmt)) {
      const id = this.node('throw', stmt);
      this.edge(id, ctx.throwTo, 'throw');
      return this.expression(stmt.expression, id, ctx);
    }
    if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) {
      const isBreak = ts.isBreakStatement(stmt);
      const target = isBreak ? ctx.breakTo : ctx.continueTo;
      if (stmt.label || !target) return this.unsupported(stmt, next, ctx,
        'Labeled or unbound break/continue is not modeled in V1');
      const id = this.node(isBreak ? 'break' : 'continue', stmt);
      this.edge(id, target, isBreak ? 'break' : 'continue');
      return id;
    }
    if (ts.isWhileStatement(stmt) || ts.isDoStatement(stmt)) {
      const loop = this.node('loop', stmt.expression, `${ts.isDoStatement(stmt) ? 'do/while' : 'while'} ${stmt.expression.getText()}`, true);
      const back = this.node('basicBlock', stmt.expression, 'loop back', true);
      this.edge(back, loop, 'back');
      const body = this.statement(stmt.statement, back, { ...ctx, breakTo: next, continueTo: loop });
      const test = this.condition(stmt.expression, body, next, ctx);
      this.edge(loop, test);
      return ts.isDoStatement(stmt) ? body : loop;
    }
    if (ts.isForStatement(stmt)) {
      const loop = this.node('loop', stmt.condition ?? stmt, stmt.condition?.getText() ?? 'true (for (;;) loop)', true);
      const back = this.node('basicBlock', stmt.incrementor ?? stmt, 'loop back', true);
      this.edge(back, loop, 'back');
      let update = back;
      if (stmt.incrementor) update = this.operation(stmt.incrementor, back, ctx, 'loop update');
      const body = this.statement(stmt.statement, update, { ...ctx, breakTo: next, continueTo: update });
      const test = stmt.condition ? this.condition(stmt.condition, body, next, ctx) : body;
      this.edge(loop, test);
      return stmt.initializer ? this.operation(stmt.initializer, loop, ctx, 'loop initializer') : loop;
    }
    if (ts.isForOfStatement(stmt) || ts.isForInStatement(stmt)) {
      const loop = this.node('loop', stmt, `next ${ts.isForOfStatement(stmt) ? 'value' : 'key'} in ${stmt.expression.getText()}`);
      const binding = this.node('basicBlock', stmt.initializer, `bind ${stmt.initializer.getText()}`);
      const back = this.node('basicBlock', stmt, 'loop back', true);
      this.edge(back, loop, 'back');
      const body = this.statement(stmt.statement, back, { ...ctx, breakTo: next, continueTo: loop });
      this.edge(binding, body);
      this.exceptional(binding, ctx);
      this.edge(loop, binding, 'true', 'has next');
      this.edge(loop, next, 'false', 'done');
      this.exceptional(loop, ctx);
      this.model.nodes.find(n => n.id === loop)!.detail = 'Iterator/enumerator protocol is opaque; iterator closing is not expanded';
      this.model.diagnostics.push({ code: 'ITERATION_PROTOCOL', message:
        'Iteration protocol and iterator closing side effects are not expanded', source: location(stmt) });
      return this.operation(stmt.expression, loop, ctx, ts.isForOfStatement(stmt) && stmt.awaitModifier
        ? 'await iterable' : 'evaluate iterable');
    }
    if (ts.isSwitchStatement(stmt)) return this.switchStatement(stmt, next, ctx);
    if (ts.isTryStatement(stmt)) return this.tryStatement(stmt, next, ctx);
    if (ts.isVariableStatement(stmt)) {
      if (stmt.declarationList.flags & ts.NodeFlags.Using) {
        return this.unsupported(stmt, next, ctx, 'Resource disposal (using/await using) is not modeled');
      }
      return this.operation(stmt, next, ctx);
    }
    if (ts.isExpressionStatement(stmt)) return this.operation(stmt.expression, next, ctx);
    if (this.canGroup(stmt)) return this.basic([stmt], next, ctx);
    return this.unsupported(stmt, next, ctx, `Statement ${ts.SyntaxKind[stmt.kind]} is opaque in V1`);
  }

  private condition(expr: ts.Expression, yes: string, no: string, ctx: Context): string {
    // Preserve predicate outcomes across short-circuit evaluation, not just call order.
    if (ts.isParenthesizedExpression(expr)) return this.condition(expr.expression, yes, no, ctx);
    if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isNonNullExpression(expr)
      || ts.isSatisfiesExpression(expr)) return this.condition(expr.expression, yes, no, ctx);
    if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
      return this.condition(expr.operand, no, yes, ctx);
    }
    if (ts.isConditionalExpression(expr)) {
      const onTrue = this.condition(expr.whenTrue, yes, no, ctx);
      const onFalse = this.condition(expr.whenFalse, yes, no, ctx);
      return this.condition(expr.condition, onTrue, onFalse, ctx);
    }
    if (ts.isBinaryExpression(expr)) {
      if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        return this.condition(expr.left, this.condition(expr.right, yes, no, ctx), no, ctx);
      }
      if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        return this.condition(expr.left, yes, this.condition(expr.right, yes, no, ctx), ctx);
      }
      if (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        const truth = this.node('condition', expr.left, `truthiness of ${expr.left.getText()}`);
        this.edge(truth, yes, 'true');
        this.edge(truth, no, 'false');
        const nullish = this.node('condition', expr.left, `${expr.left.getText()} is nullish?`);
        this.edge(nullish, this.condition(expr.right, yes, no, ctx), 'true');
        this.edge(nullish, truth, 'false');
        return this.expression(expr.left, nullish, ctx);
      }
    }
    const id = this.node('condition', expr);
    this.edge(id, yes, 'true');
    this.edge(id, no, 'false');
    this.exceptional(id, ctx);
    return this.expression(expr, id, ctx);
  }

  private operation(ast: ts.Node, next: string, ctx: Context, prefix?: string): string {
    // A bare call already has an exact semantic node, so do not duplicate it as a basic block.
    if (ts.isCallExpression(ast) || ts.isNewExpression(ast) || ts.isAwaitExpression(ast)) return this.expression(ast, next, ctx);
    const id = this.node('basicBlock', ast, prefix ? `${prefix}: ${ast.getText()}` : ast.getText());
    this.edge(id, next);
    this.exceptional(id, ctx);
    return this.expression(ast, id, ctx);
  }

  private expression(ast: ts.Node, next: string, ctx: Context): string {
    if (isExecutableFunction(ast)) return next;
    if (ts.isVariableDeclaration(ast) && !ts.isIdentifier(ast.name)) {
      const binding = this.unsupported(ast.name, next, ctx, 'Destructuring defaults and binding side effects are opaque in V1');
      return ast.initializer ? this.expression(ast.initializer, binding, ctx) : binding;
    }
    if (ts.isClassExpression(ast) || ts.isTaggedTemplateExpression(ast) || ts.isYieldExpression(ast)
      || ts.isSpreadElement(ast) || ts.isSpreadAssignment(ast)) {
      return this.unsupported(ast, next, ctx, `Expression ${ts.SyntaxKind[ast.kind]} is opaque in V1`);
    }
    if (ast.flags & ts.NodeFlags.OptionalChain) {
      return this.unsupported(ast, next, ctx, 'Optional-chain evaluation is opaque in V1; skipped calls are not fabricated');
    }
    if (ts.isConditionalExpression(ast)) {
      const yes = this.expression(ast.whenTrue, next, ctx);
      const no = this.expression(ast.whenFalse, next, ctx);
      return this.condition(ast.condition, yes, no, ctx);
    }
    if (ts.isBinaryExpression(ast) && this.lazyOperator(ast.operatorToken.kind)) {
      const kind = ast.operatorToken.kind;
      if (kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken || kind === ts.SyntaxKind.BarBarEqualsToken
        || kind === ts.SyntaxKind.QuestionQuestionEqualsToken) {
        return this.unsupported(ast, next, ctx, 'Logical assignment side effects are opaque in V1');
      }
      const right = this.expression(ast.right, next, ctx);
      if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return this.condition(ast.left, right, next, ctx);
      if (kind === ts.SyntaxKind.BarBarToken) return this.condition(ast.left, next, right, ctx);
      const id = this.node('condition', ast.left, kind === ts.SyntaxKind.QuestionQuestionToken
        ? `${ast.left.getText()} is nullish?` : ast.left.getText());
      this.edge(id, right, 'true');
      this.edge(id, next, 'false');
      return this.expression(ast.left, id, ctx);
    }
    if (ts.isCallExpression(ast) || ts.isNewExpression(ast)) {
      const id = this.node('call', ast);
      const call = resolveCall(this.checker, ast, id);
      this.model.calls.push(call);
      this.model.nodes.find(n => n.id === id)!.callSiteId = call.id;
      this.edge(id, next);
      this.exceptional(id, ctx);
      const children: ts.Node[] = [ast.expression, ...(ast.arguments ?? [])];
      let first = id;
      for (let i = children.length - 1; i >= 0; i--) first = this.expression(children[i], first, ctx);
      return first;
    }
    if (ts.isAwaitExpression(ast)) {
      const id = this.node('basicBlock', ast, `await ${ast.expression.getText()}`);
      this.model.nodes.find(n => n.id === id)!.detail = 'Static continuation only; runtime scheduling is not modeled';
      this.edge(id, next);
      this.exceptional(id, ctx);
      return this.expression(ast.expression, id, ctx);
    }
    if (ts.isPropertyAccessExpression(ast) || ts.isElementAccessExpression(ast)
      || ts.isBinaryExpression(ast) || ts.isPrefixUnaryExpression(ast) || ts.isPostfixUnaryExpression(ast)) {
      const id = this.node('basicBlock', ast, `evaluate ${ast.getText()}`);
      this.edge(id, next);
      this.exceptional(id, ctx);
      next = id;
    }
    const children: ts.Node[] = [];
    ts.forEachChild(ast, child => { children.push(child); });
    let first = next;
    for (let i = children.length - 1; i >= 0; i--) first = this.expression(children[i], first, ctx);
    return first;
  }

  private switchStatement(stmt: ts.SwitchStatement, next: string, ctx: Context): string {
    const clauses = stmt.caseBlock.clauses;
    const entries = new Map<ts.CaseOrDefaultClause, string>();
    let fallthrough = next;
    for (let i = clauses.length - 1; i >= 0; i--) {
      fallthrough = this.statements(clauses[i].statements, fallthrough, { ...ctx, breakTo: next });
      entries.set(clauses[i], fallthrough);
    }
    const defaultClause = clauses.find(ts.isDefaultClause);
    let dispatch = defaultClause ? entries.get(defaultClause)! : next;
    for (let i = clauses.length - 1; i >= 0; i--) {
      const clause = clauses[i];
      if (!ts.isCaseClause(clause)) continue;
      const test = this.node('condition', clause.expression,
        `${stmt.expression.getText()} === ${clause.expression.getText()}`);
      this.edge(test, entries.get(clause)!, 'case', clause.expression.getText());
      this.edge(test, dispatch, 'default', 'no match');
      dispatch = this.expression(clause.expression, test, ctx);
    }
    return this.operation(stmt.expression, dispatch, ctx, 'switch discriminant');
  }

  private tryStatement(stmt: ts.TryStatement, next: string, ctx: Context): string {
    const wrapped = new Map<string, string>();
    const wrap = (target: string, completion: EdgeKind): string => {
      if (!stmt.finallyBlock) return target;
      const key = `${completion}:${target}`;
      if (wrapped.has(key)) return wrapped.get(key)!;
      const resume = this.node('basicBlock', stmt.finallyBlock, `resume ${completion}`, true);
      this.edge(resume, target, completion);
      const body = this.statements(stmt.finallyBlock.statements, resume, ctx);
      const marker = this.node('basicBlock', stmt.finallyBlock, `finally (${completion})`, true);
      this.edge(marker, body, 'finally');
      wrapped.set(key, marker);
      return marker;
    };
    const inner: Context = { ...ctx, returnTo: wrap(ctx.returnTo, 'return'),
      throwTo: wrap(ctx.throwTo, 'throw'),
      breakTo: ctx.breakTo ? wrap(ctx.breakTo, 'break') : undefined,
      continueTo: ctx.continueTo ? wrap(ctx.continueTo, 'continue') : undefined };
    const normal = wrap(next, 'next');
    let exception = inner.throwTo;
    if (stmt.catchClause) {
      const catchBody = this.statements(stmt.catchClause.block.statements, normal, inner);
      exception = this.node('basicBlock', stmt.catchClause.variableDeclaration ?? stmt.catchClause, 'catch', true);
      this.edge(exception, catchBody);
      if (stmt.catchClause.variableDeclaration && !ts.isIdentifier(stmt.catchClause.variableDeclaration.name)) {
        this.exceptional(exception, inner);
        this.model.diagnostics.push({ code: 'CATCH_BINDING', message:
          'Catch destructuring is opaque and may throw during binding', source: location(stmt.catchClause.variableDeclaration) });
      }
    }
    return this.statements(stmt.tryBlock.statements, normal, { ...inner, throwTo: exception });
  }
}
