/**
 * Quark expression evaluator.
 *
 * Evaluates `@excom/quark-parser` expression ASTs against a scope
 * (built by `resolveVariable`). Replaces the old `new Function` + `with`
 * path: no arbitrary JS, CSP-safe, methods limited to an allowlist of
 * pure / read-only calls.
 */
import { METHOD_ALLOWLIST } from "./language-tables";
import type {
  Argument,
  Expression,
  Interpolation,
} from "@excom/quark-parser";
import { parseExpression } from "@excom/quark-parser";

export interface EvalContext {
  /** Lazy name resolver (see `createScope` in variables.ts). */
  scope: { lookup(name: string): unknown };
  element: Element;
}

export class QuarkEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuarkEvalError";
  }
}

/**
 * Parse an expression source to an AST, memoized. Declaration values
 * repeat a lot across elements / runs, so each unique source parses
 * once.
 */
const EXPRESSION_CACHE = new Map<string, Expression>();
export const getExpressionAst = (src: string): Expression => {
  let ast = EXPRESSION_CACHE.get(src);
  if (!ast) {
    ast = parseExpression(src);
    EXPRESSION_CACHE.set(src, ast);
  }
  return ast;
};

/**
 * Collect referenced `$variable` names (prefixed with `$`, same shape
 * as the old `extractVarNames` used by `resolveVariable`).
 */
export const collectVariableNames = (expr: Expression): string[] => {
  const names = new Set<string>();
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.type === "variable") names.add("$" + node.name);
    for (const key in node) {
      if (key === "start" || key === "end" || key === "type") continue;
      const value = node[key];
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(expr);
  return [...names];
};

/**
 * Collect literal string args of `<callee>("name")` calls (`attr("x")`,
 * `prop("x")`). Only static names can be observed (attr filters and
 * property subscriptions come from them). Non-literal args set
 * `hasNonLiteral` so callers can warn.
 */
export const collectLiteralCalls = (
  expr: Expression | null,
  callee: string
): { names: string[]; hasNonLiteral: boolean } => {
  const names = new Set<string>();
  let hasNonLiteral = false;
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (
      node.type === "function" &&
      node.callee?.type === "identifier" &&
      node.callee.name === callee
    ) {
      const arg = node.args?.[0]?.value;
      if (arg?.type === "string" && arg.value != null) {
        names.add(arg.value);
      } else {
        hasNonLiteral = true;
      }
    }
    for (const key in node) {
      if (key === "start" || key === "end" || key === "type") continue;
      const value = node[key];
      if (value && typeof value === "object") visit(value);
    }
  };
  if (expr) visit(expr);
  return { names: [...names], hasNonLiteral };
};

export const collectAttrCalls = (expr: Expression | null) =>
  collectLiteralCalls(expr, "attr");
export const collectPropCalls = (expr: Expression | null) =>
  collectLiteralCalls(expr, "prop");

const unescapeString = (raw: string): string =>
  raw.includes("\\")
    ? raw.replace(/\\(.)/g, (_, c: string) =>
        c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c
      )
    : raw;

const interpolationToString = (value: any): string =>
  value == null ? "" : String(value);

const truthy = (value: any): boolean => !!value;

export const evaluateExpression = (
  expr: Expression,
  context: EvalContext
): any => {
  return evaluate(expr, context);
};

const evaluate = (node: Expression, ctx: EvalContext): any => {
  switch (node.type) {
    case "string": {
      if (node.value !== null) return unescapeString(node.value);
      return node.parts
        .map((part) =>
          typeof part === "string"
            ? unescapeString(part)
            : interpolationToString(evaluate(part.expression, ctx))
        )
        .join("");
    }
    case "number":
      return node.unit ? `${node.value}${node.unit}` : node.value;
    case "color":
      return node.value;
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "identifier":
      // unknown bare identifiers throw inside `lookup`
      return ctx.scope.lookup(node.name);
    case "variable":
      // `$bindings` never throw: unbound resolves to `undefined` (wipe)
      return ctx.scope.lookup("$" + node.name);
    case "parent_reference":
      // Legacy behavior: `&` in an expression resolves to the element's tag
      // name (used as a selector string).
      return ctx.element.localName;
    case "interpolation":
      return evaluate(node.expression, ctx);
    case "url":
      return node.parts
        .map((part) =>
          typeof part === "string"
            ? part
            : interpolationToString(evaluate(part.expression, ctx))
        )
        .join("");
    case "member": {
      // Null propagation is built in: accessing a field of null/undefined
      // resolves to undefined instead of erroring.
      const object = evaluate(node.object, ctx);
      if (object == null) return undefined;
      return object[node.variable ? "$" + node.property : node.property];
    }
    case "index": {
      const object = evaluate(node.object, ctx);
      if (object == null) return undefined;
      return object[evaluate(node.index, ctx)];
    }
    case "function":
      return evaluateCall(node.callee, node.args, ctx);
    case "if": {
      // CSS-style `if($cond: a; else: b)`: first truthy arm wins.
      for (const arm of node.arms) {
        if (arm.condition === null || truthy(evaluate(arm.condition, ctx))) {
          return evaluate(arm.value, ctx);
        }
      }
      // No arm matched and no `else`: undefined = Quark no-op.
      return undefined;
    }
    case "unary": {
      const value = evaluate(node.argument, ctx);
      if (node.operator === "-") return -value;
      if (node.operator === "+") return +value;
      return !truthy(value);
    }
    case "binary": {
      const left = evaluate(node.left, ctx);
      switch (node.operator) {
        // Short-circuiting, JS semantics (matches the legacy eval behavior).
        case "and":
          return truthy(left) ? evaluate(node.right, ctx) : left;
        case "or":
          return truthy(left) ? left : evaluate(node.right, ctx);
      }
      const right = evaluate(node.right, ctx);
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "%":
          return left % right;
        // Loose equality preserves legacy `==` behavior in existing sheets.

        case "==":
          return left == right;

        case "!=":
          return left != right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
      }
      throw new QuarkEvalError(`Unknown operator "${node.operator}"`);
    }
    case "list":
      return node.items.map((item) => evaluate(item, ctx));
    case "map": {
      const result: Record<string, any> = {};
      for (const entry of node.entries) {
        result[mapKeyToString(entry.key, ctx)] = evaluate(entry.value, ctx);
      }
      return result;
    }
    default:
      throw new QuarkEvalError(
        `Unsupported expression node "${(node as Expression).type}"`
      );
  }
};

/** Map keys: bare identifiers are literal strings (`(a: 1)` -> key "a"). */
const mapKeyToString = (key: Expression, ctx: EvalContext): string => {
  if (key.type === "identifier") return key.name;
  return interpolationToString(evaluate(key, ctx));
};

const evaluateCall = (
  callee: Expression,
  args: Argument[],
  ctx: EvalContext
): any => {
  const argValues: any[] = [];
  for (const arg of args) {
    const value = evaluate(arg.value, ctx);
    if (arg.spread) {
      if (Array.isArray(value)) argValues.push(...value);
      else argValues.push(value);
    } else {
      argValues.push(value);
    }
  }

  // Method call on a value (dot accessor).
  if (callee.type === "member") {
    const object = evaluate(callee.object, ctx);
    const method = callee.property;
    // Null propagation: calling a method on null/undefined is a no-op.
    if (object == null) return undefined;
    const own =
      typeof object === "object" &&
      Object.prototype.hasOwnProperty.call(object, method);
    if (own && typeof object[method] === "function") {
      // Own-property functions are user-provided (e.g. @use module
      // namespaces like `api.version()`), not built-in prototype methods.
      return object[method](...argValues);
    }
    // Prototype methods (string/array/number/DOM) are allowlisted only
    // (`ALLOWED_METHOD_NAMES` in language-tables.ts).
    if (!METHOD_ALLOWLIST.has(method)) {
      throw new QuarkEvalError(
        `Method "${method}" is not allowed in Quark expressions. ` +
          `Register a module function and call it instead.`
      );
    }
    const fn = object[method];
    if (typeof fn !== "function") {
      throw new QuarkEvalError(`"${method}" is not a function`);
    }
    return fn.apply(object, argValues);
  }

  const fn = evaluate(callee, ctx);
  if (typeof fn !== "function") {
    throw new QuarkEvalError(
      `"${callee.type === "identifier" ? callee.name : "<expression>"}" is not a function`
    );
  }
  return fn(...argValues);
};

export type { Expression, Interpolation };
