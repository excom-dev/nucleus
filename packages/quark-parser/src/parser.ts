import { QuarkParseError } from "./error";
import type { QuarkAtRuleName } from "./tables";
import { ATTR_OPERATORS, BINARY_BP, NOT_BP, SELECTOR_PSEUDOS } from "./tables";
import { tokenize } from "./tokenizer";
import type {
  ActionRule,
  Argument,
  AtRule,
  AttributeSelector,
  Block,
  CommentNode,
  Declaration,
  DelayRule,
  EventName,
  Expression,
  FunctionCall,
  IfArm,
  IfFunction,
  Interpolation,
  ListenerOption,
  ListenerRule,
  ListLiteral,
  MapEntry,
  Member,
  Property,
  RawArgument,
  Rule,
  ScopeRule,
  Selector,
  SelectorList,
  SelectorPart,
  Statement,
  Stylesheet,
  Token,
  TransitionRule,
  UseRule,
  ValueAtRule,
  Variable,
} from "./types";

/** Parse a full Quark stylesheet into an AST. */
export function parse(source: string): Stylesheet {
  return new Parser(source).parseStylesheet();
}

/** Parse a standalone expression (e.g. a declaration value on its own). */
export function parseExpression(source: string): Expression {
  return new Parser(source).parseStandaloneExpression();
}

/** Parse a standalone selector list (e.g. a rule selector on its own). */
export function parseSelectorList(source: string): SelectorList {
  return new Parser(source).parseStandaloneSelectorList();
}

const HEX_COLOR = /^[0-9a-fA-F]+$/;
/**
 * Quark's at-rules and the method that parses each. The table is the whole
 * set: an at-rule missing from it is a parse error.
 */
const AT_RULE_PARSERS: Readonly<
  Record<QuarkAtRuleName, (parser: Parser, at: Token) => AtRule>
> = {
  use: (p, at) => p.parseUseRule(at),
  scope: (p, at) => p.parseScopeRule(at),
  on: (p, at) => p.parseListenerRule(at),
  dispatch: (p, at) => p.parseActionRule(at),
  command: (p, at) => p.parseActionRule(at),
  "view-transition": (p, at) => p.parseTransitionRule(at),
  delay: (p, at) => p.parseDelayRule(at),
  warn: (p, at) => p.parseValueAtRule(at),
  debug: (p, at) => p.parseValueAtRule(at),
  error: (p, at) => p.parseValueAtRule(at),
};
/** Tokens that terminate a value/space-list in any context. */
const HARD_STOPS = new Set([",", ";", ")", "]", "}", "{", ":", "!"]);

class Parser {
  private source: string;
  private tokens: Token[];
  private comments: Token[];
  private pos = 0;
  private commentIdx = 0;
  private lastEnd = 0;

  constructor(source: string, tokens?: Token[], comments?: Token[]) {
    this.source = source;
    if (tokens) {
      this.tokens = tokens;
      this.comments = comments ?? [];
    } else {
      const result = tokenize(source);
      this.tokens = result.tokens;
      this.comments = result.comments;
    }
  }

  /*
   * -------------------------------------------------------------------------
   * Cursor helpers
   * -------------------------------------------------------------------------
   */

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) this.fail("Unexpected end of input");
    this.pos++;
    this.lastEnd = t.end;
    return t;
  }

  private atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private isPunct(value: string, offset = 0): boolean {
    const t = this.tokens[this.pos + offset];
    return t !== undefined && t.type === "punct" && t.value === value;
  }

  private isIdent(value: string, offset = 0): boolean {
    const t = this.tokens[this.pos + offset];
    return t !== undefined && t.type === "ident" && t.value === value;
  }

  private expectPunct(value: string): Token {
    const t = this.peek();
    if (!t || t.type !== "punct" || t.value !== value) {
      this.fail(`Expected "${value}"${t ? ` but found "${t.value}"` : ""}`);
    }
    return this.next();
  }

  private expectIdent(): Token {
    const t = this.peek();
    if (!t || t.type !== "ident") {
      this.fail(`Expected identifier${t ? ` but found "${t.value}"` : ""}`);
    }
    return this.next();
  }

  private expectString(): Token {
    const t = this.peek();
    if (!t || t.type !== "string") {
      this.fail(`Expected string${t ? ` but found "${t.value}"` : ""}`);
    }
    return this.next();
  }

  private fail(message: string, at?: number): never {
    const position = at ?? this.peek()?.start ?? this.source.length;
    throw new QuarkParseError(message, this.source, position);
  }

  /*
   * -------------------------------------------------------------------------
   * Statements
   * -------------------------------------------------------------------------
   */

  parseStylesheet(): Stylesheet {
    const body: Statement[] = [];
    for (;;) {
      this.flushComments(body, this.peek()?.start ?? Infinity);
      if (this.atEnd()) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    return { type: "stylesheet", body, start: 0, end: this.source.length };
  }

  parseStandaloneExpression(): Expression {
    const expr = this.parseValue();
    if (!this.atEnd()) this.fail("Unexpected trailing input");
    return expr;
  }

  parseStandaloneSelectorList(): SelectorList {
    const list = this.parseSelectorList(["{"]);
    if (!this.atEnd()) this.fail("Unexpected trailing input");
    return list;
  }

  private flushComments(body: Statement[], before: number): void {
    while (
      this.commentIdx < this.comments.length &&
      this.comments[this.commentIdx].start < before
    ) {
      const c = this.comments[this.commentIdx++];
      const node: CommentNode = {
        type: "comment",
        text: c.value,
        start: c.start,
        end: c.end,
      };
      body.push(node);
    }
  }

  private parseStatement(): Statement | null {
    if (this.isPunct(";")) {
      this.next();
      return null;
    }
    const t = this.peek()!;
    if (t.type === "at") return this.parseAtRule();

    const la = this.lookahead();
    if (la.term === "{") {
      /* A key then a block (`font: { … }`, `font: bold { … }`) is a nested
       * property block; `a:hover { … }`, with no space, is a rule. */
      const after = this.peek(2);
      if (
        t.type === "ident" &&
        this.isPunct(":", 1) &&
        la.colon === this.pos + 1 &&
        after !== undefined &&
        (after.ws || (after.type === "punct" && after.value === "{"))
      ) {
        this.fail("Nested property blocks are not supported", t.start);
      }
      return this.parseRule();
    }
    if (la.colon >= 0) return this.parseDeclaration();
    this.fail("Expected declaration or rule");
  }

  /**
   * Scans forward (without consuming) to the token that terminates the
   * current statement: `{`, `;`, `}`, or end of input, tracking nesting so
   * parens, brackets, and interpolations are skipped. Also records the first
   * top-level `:`.
   */
  private lookahead(): { term: string; colon: number } {
    const toks = this.tokens;
    let depth = 0;
    let colon = -1;
    for (let j = this.pos; j < toks.length; j++) {
      const t = toks[j];
      if (t.type !== "punct") continue;
      const v = t.value;
      if (v === "(" || v === "[" || v === "#{") depth++;
      else if (v === ")" || v === "]") depth--;
      else if (v === "{") {
        if (depth > 0) depth++;
        else return { term: "{", colon };
      } else if (v === "}") {
        if (depth > 0) depth--;
        else return { term: "}", colon };
      } else if (v === ";" && depth === 0) {
        return { term: ";", colon };
      } else if ((v === ":" || v === "::") && depth === 0 && colon < 0) {
        colon = j;
      }
    }
    return { term: "eof", colon };
  }

  private parseRule(): Rule {
    const start = this.peek()!.start;
    const selector = this.parseSelectorList(["{"]);
    const block = this.parseBlock();
    return { type: "rule", selector, block, start, end: block.end };
  }

  private parseBlock(): Block {
    const open = this.expectPunct("{");
    const body: Statement[] = [];
    for (;;) {
      this.flushComments(body, this.peek()?.start ?? Infinity);
      if (this.atEnd()) this.fail("Unclosed block", open.start);
      if (this.isPunct("}")) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    const close = this.next();
    return { type: "block", body, start: open.start, end: close.end };
  }

  /*
   * -------------------------------------------------------------------------
   * Declarations
   * -------------------------------------------------------------------------
   */

  private parseDeclaration(): Declaration {
    const startTok = this.peek()!;
    let property: Property | Variable;
    if (startTok.type === "variable") {
      this.next();
      /* A member key (`$sig.value:`) was the signal write form, removed
       * 2026-09-13: bindings are written on the owner (an `@on` block
       * there, or `element.quark.setProperty()` from JS). */
      if (this.isPunct(".") && !this.peek()!.ws) {
        this.fail(
          `Member keys ($${startTok.value}.…:) are not supported: declare $${startTok.value} on the owner rule, write it from an @on block on the owner, or from JS via element.quark.setProperty()`,
          this.peek()!.start
        );
      }
      property = {
        type: "variable",
        name: startTok.value,
        start: startTok.start,
        end: startTok.end,
      };
    } else {
      property = this.parsePropertyName();
    }
    this.expectPunct(":");
    const value = this.parseValue();
    if (this.isPunct("!")) {
      const bang = this.next();
      this.fail(`!${this.expectIdent().value} is not supported`, bang.start);
    }

    if (this.isPunct(";")) this.next();
    else if (!this.atEnd() && !this.isPunct("}")) {
      this.fail(
        `Expected ";" but found "${this.peek()!.value}"` +
          (this.isPunct("?")
            ? " (JS-style ternary/optional-chaining syntax is not supported in Quark)"
            : "")
      );
    }

    return {
      type: "declaration",
      property,
      value,
      start: startTok.start,
      end: this.lastEnd,
    };
  }

  private parsePropertyName(): Property {
    const startTok = this.peek()!;
    let name = "";
    let end = startTok.start;
    let first = true;
    for (;;) {
      const t = this.peek();
      if (!t || (!first && t.ws)) break;
      if (t.type === "punct" && t.value === "#{") {
        this.fail("Interpolation is only supported inside strings", t.start);
      }
      if (t.type !== "ident" && !(t.type === "punct" && t.value === "*")) {
        break;
      }
      this.next();
      name += t.value;
      end = t.end;
      first = false;
    }
    if (!name) this.fail("Expected property name");
    return { type: "property", name, start: startTok.start, end };
  }

  /*
   * -------------------------------------------------------------------------
   * Selectors
   * -------------------------------------------------------------------------
   */

  private parseSelectorList(stops: string[]): SelectorList {
    const start = this.peek()?.start ?? this.lastEnd;
    const selectors: Selector[] = [];
    for (;;) {
      selectors.push(this.parseSelector(stops));
      if (this.isPunct(",")) {
        this.next();
        continue;
      }
      break;
    }
    return {
      type: "selector_list",
      selectors,
      start,
      end: this.lastEnd,
    };
  }

  private parseSelector(stops: string[]): Selector {
    const parts: SelectorPart[] = [];
    const start = this.peek()?.start ?? this.lastEnd;
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.type === "punct" && (stops.includes(t.value) || t.value === ",")) {
        break;
      }
      if (
        t.type === "punct" &&
        (t.value === ">" || t.value === "+" || t.value === "~")
      ) {
        this.next();
        parts.push({
          type: "combinator",
          value: t.value as ">" | "+" | "~",
          start: t.start,
          end: t.end,
        });
        continue;
      }
      if (
        parts.length &&
        t.ws &&
        parts[parts.length - 1].type !== "combinator"
      ) {
        parts.push({
          type: "combinator",
          value: " ",
          start: this.lastEnd,
          end: t.start,
        });
      }
      parts.push(this.parseCompoundPart());
    }
    if (!parts.length) this.fail("Expected selector");
    return { type: "selector", parts, start, end: this.lastEnd };
  }

  private parseCompoundPart(): SelectorPart {
    const t = this.peek()!;
    switch (t.type) {
      case "ident": {
        this.next();
        return {
          type: "type_selector",
          name: t.value,
          start: t.start,
          end: t.end,
        };
      }
      case "hash": {
        this.next();
        return {
          type: "id_selector",
          name: t.value,
          start: t.start,
          end: t.end,
        };
      }
      case "punct":
        switch (t.value) {
          case "*": {
            this.next();
            return {
              type: "type_selector",
              name: "*",
              start: t.start,
              end: t.end,
            };
          }
          case ".": {
            this.next();
            return {
              type: "class_selector",
              name: this.expectIdent().value,
              start: t.start,
              end: this.lastEnd,
            };
          }
          case "%":
            this.fail("Placeholder selectors are not supported", t.start);
            break;
          case "&": {
            this.next();
            let suffix: string | null = null;
            const nextTok = this.peek();
            if (nextTok && !nextTok.ws && nextTok.type === "ident") {
              this.next();
              suffix = nextTok.value;
            }
            return {
              type: "parent_selector",
              suffix,
              start: t.start,
              end: this.lastEnd,
            };
          }
          case "#{":
            this.fail(
              "Interpolation is only supported inside strings",
              t.start
            );
            break;
          case "[":
            return this.parseAttributeSelector();
          case ":": {
            this.next();
            const nameTok = this.expectIdent();
            let argument: SelectorList | RawArgument | null = null;
            if (this.isPunct("(") && !this.peek()!.ws) {
              if (SELECTOR_PSEUDOS.has(nameTok.value)) {
                this.expectPunct("(");
                argument = this.parseSelectorList([")"]);
                this.expectPunct(")");
              } else {
                argument = this.parseRawParens();
              }
            }
            return {
              type: "pseudo_class_selector",
              name: nameTok.value,
              argument,
              start: t.start,
              end: this.lastEnd,
            };
          }
          case "::": {
            this.next();
            const nameTok = this.expectIdent();
            let argument: RawArgument | null = null;
            if (this.isPunct("(") && !this.peek()!.ws) {
              argument = this.parseRawParens();
            }
            return {
              type: "pseudo_element_selector",
              name: nameTok.value,
              argument,
              start: t.start,
              end: this.lastEnd,
            };
          }
        }
        break;
    }
    this.fail(`Unexpected token "${t.value}" in selector`);
  }

  private parseAttributeSelector(): AttributeSelector {
    const open = this.expectPunct("[");
    const name = this.expectIdent().value;
    let operator: string | null = null;
    let value: Expression | null = null;
    let modifier: string | null = null;
    const opTok = this.peek();
    if (opTok && opTok.type === "punct" && ATTR_OPERATORS.has(opTok.value)) {
      this.next();
      operator = opTok.value;
      const v = this.peek();
      if (!v) this.fail("Expected attribute value");
      if (v.type === "string") {
        this.next();
        value = this.makeString(v);
      } else if (v.type === "ident") {
        this.next();
        value = {
          type: "identifier",
          name: v.value,
          start: v.start,
          end: v.end,
        };
      } else if (v.type === "number") {
        this.next();
        value = {
          type: "number",
          value: parseFloat(v.value),
          unit: v.unit ?? null,
          start: v.start,
          end: v.end,
        };
      } else if (v.type === "punct" && v.value === "#{") {
        this.fail("Interpolation is only supported inside strings", v.start);
      } else {
        this.fail(`Unexpected attribute value "${v.value}"`);
      }
      const mod = this.peek();
      if (
        mod &&
        mod.type === "ident" &&
        (mod.value === "i" || mod.value === "s")
      ) {
        this.next();
        modifier = mod.value;
      }
    }
    const close = this.expectPunct("]");
    return {
      type: "attribute_selector",
      name,
      operator,
      value,
      modifier,
      start: open.start,
      end: close.end,
    };
  }

  private parseRawParens(): RawArgument {
    const open = this.expectPunct("(");
    let depth = 1;
    let end = open.end;
    while (depth > 0) {
      const t = this.next();
      if (t.type === "punct") {
        if (t.value === "(" || t.value === "#{") depth++;
        else if (t.value === ")") depth--;
        else if (t.value === "}") depth--;
      }
      if (depth > 0) end = t.end;
    }
    return {
      type: "raw",
      value: this.source.slice(open.end, end).trim(),
      start: open.start,
      end: this.lastEnd,
    };
  }

  /*
   * -------------------------------------------------------------------------
   * Expressions
   * -------------------------------------------------------------------------
   */

  /** Full declaration-value grammar: comma lists of space lists. */
  private parseValue(): Expression {
    const start = this.peek()?.start ?? this.lastEnd;
    const first = this.parseSpaceList();
    if (!this.isPunct(",")) return first;
    const items = [first];
    while (this.isPunct(",")) {
      this.next();
      if (!this.canStartExpression()) break; // tolerate trailing comma
      items.push(this.parseSpaceList());
    }
    return {
      type: "list",
      separator: ",",
      items,
      brackets: false,
      parens: false,
      start,
      end: this.lastEnd,
    };
  }

  private parseSpaceList(): Expression {
    const start = this.peek()?.start ?? this.lastEnd;
    const first = this.parseExpr(0);
    if (!this.canStartExpression()) return first;
    const items = [first];
    while (this.canStartExpression()) items.push(this.parseExpr(0));
    return {
      type: "list",
      separator: " ",
      items,
      brackets: false,
      parens: false,
      start,
      end: this.lastEnd,
    };
  }

  private canStartExpression(): boolean {
    const t = this.peek();
    if (!t) return false;
    switch (t.type) {
      case "ident":
      case "variable":
      case "string":
      case "number":
      case "hash":
        return true;
      case "punct":
        if (HARD_STOPS.has(t.value)) return false;
        return (
          t.value === "(" ||
          t.value === "[" ||
          t.value === "#{" ||
          t.value === "&"
        );
      default:
        return false;
    }
  }

  private parseExpr(minBp: number): Expression {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      let op: string | null = null;
      if (t.type === "punct" && BINARY_BP[t.value] !== undefined) op = t.value;
      else if (t.type === "ident" && (t.value === "and" || t.value === "or")) {
        op = t.value;
      }
      if (!op) break;
      const bp = BINARY_BP[op];
      if (bp <= minBp) break;
      this.next();
      const right = this.parseExpr(bp);
      left = {
        type: "binary",
        operator: op as never,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
    return left;
  }

  private parseUnary(): Expression {
    const t = this.peek();
    if (!t) this.fail("Unexpected end of input");
    if (t.type === "punct" && (t.value === "-" || t.value === "+")) {
      this.next();
      const argument = this.parseUnary();
      return {
        type: "unary",
        operator: t.value as "-" | "+",
        argument,
        start: t.start,
        end: argument.end,
      };
    }
    if (t.type === "ident" && t.value === "not") {
      this.next();
      const argument = this.parseExpr(NOT_BP);
      return {
        type: "unary",
        operator: "not",
        argument,
        start: t.start,
        end: argument.end,
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (!t || t.type !== "punct") break;
      if (t.value === ".") {
        const prop = this.peek(1);
        if (!prop || (prop.type !== "ident" && prop.type !== "variable")) {
          this.fail('Expected property name after "."', t.start);
        }
        this.next();
        this.next();
        const member: Member = {
          type: "member",
          object: node,
          property: prop.value,
          variable: prop.type === "variable",
          start: node.start,
          end: prop.end,
        };
        node = member;
        continue;
      }
      if (t.value === "[" && !t.ws) {
        this.next();
        const index = this.parseExpr(0);
        const close = this.expectPunct("]");
        node = {
          type: "index",
          object: node,
          index,
          start: node.start,
          end: close.end,
        };
        continue;
      }
      if (
        t.value === "(" &&
        !t.ws &&
        (node.type === "identifier" ||
          node.type === "member" ||
          node.type === "interpolation")
      ) {
        const args = this.parseArguments();
        const call: FunctionCall = {
          type: "function",
          callee: node,
          args,
          start: node.start,
          end: this.lastEnd,
        };
        node = call;
        continue;
      }
      break;
    }
    return node;
  }

  private parsePrimary(): Expression {
    const t = this.peek();
    if (!t) this.fail("Unexpected end of input");
    switch (t.type) {
      case "number":
        this.next();
        return {
          type: "number",
          value: parseFloat(t.value),
          unit: t.unit ?? null,
          start: t.start,
          end: t.end,
        };
      case "string":
        this.next();
        return this.makeString(t);
      case "variable":
        this.next();
        return { type: "variable", name: t.value, start: t.start, end: t.end };
      case "hash": {
        this.next();
        if (HEX_COLOR.test(t.value)) {
          return {
            type: "color",
            value: "#" + t.value,
            start: t.start,
            end: t.end,
          };
        }
        return {
          type: "identifier",
          name: "#" + t.value,
          start: t.start,
          end: t.end,
        };
      }
      case "ident": {
        if (t.value === "true" || t.value === "false") {
          this.next();
          return {
            type: "boolean",
            value: t.value === "true",
            start: t.start,
            end: t.end,
          };
        }
        if (t.value === "null") {
          this.next();
          return { type: "null", start: t.start, end: t.end };
        }
        /*
         * CSS-style conditional: `if($cond: a; else: b)`. Only when the
         * parens contain top-level `condition: value` arms; a colon-less
         * `if(...)` falls through to a regular function call.
         */
        if (
          t.value === "if" &&
          this.isPunct("(", 1) &&
          !this.peek(1)!.ws &&
          this.ifParensHaveArms()
        ) {
          return this.parseIfFunction(t);
        }
        // Unquoted url(...): tokenizer emitted [ident url, "(", url, ")"].
        if (this.peek(1)?.type === "punct" && this.isPunct("(", 1)) {
          const rawTok = this.peek(2);
          if (rawTok?.type === "url") {
            this.next(); // url ident
            this.next(); // (
            this.next(); // raw
            const close = this.expectPunct(")");
            return {
              type: "url",
              parts: this.splitInterpolatable(rawTok.value, rawTok.start),
              start: t.start,
              end: close.end,
            };
          }
        }
        this.next();
        return {
          type: "identifier",
          name: t.value,
          start: t.start,
          end: t.end,
        };
      }
      case "punct":
        switch (t.value) {
          case "(":
            return this.parseParens();
          case "[":
            return this.parseBracketList();
          case "#{":
            return this.parseInterpolation();
          case "&": {
            this.next();
            if (this.isPunct("&") && !this.peek()!.ws) {
              this.fail(
                '"&&" is not supported in Quark (JS-style logical operators are not part of the language)',
                t.start
              );
            }
            return { type: "parent_reference", start: t.start, end: t.end };
          }
        }
        break;
    }
    this.fail(
      `Unexpected token "${t.value}"` +
        (t.value === "?"
          ? " (JS-style ternary/optional-chaining syntax is not supported in Quark)"
          : "")
    );
  }

  /** `(...)`: grouping, comma list, or map. */
  private parseParens(): Expression {
    const open = this.expectPunct("(");
    if (this.isPunct(")")) {
      const close = this.next();
      return {
        type: "list",
        separator: ",",
        items: [],
        brackets: false,
        parens: true,
        start: open.start,
        end: close.end,
      };
    }
    const first = this.parseSpaceList();
    if (this.isPunct(":")) {
      // Map literal.
      const entries: MapEntry[] = [];
      this.next();
      entries.push({ key: first, value: this.parseSpaceList() });
      while (this.isPunct(",")) {
        this.next();
        if (this.isPunct(")")) break;
        const key = this.parseSpaceList();
        this.expectPunct(":");
        entries.push({ key, value: this.parseSpaceList() });
      }
      const close = this.expectPunct(")");
      return { type: "map", entries, start: open.start, end: close.end };
    }
    if (this.isPunct(",")) {
      const items = [first];
      while (this.isPunct(",")) {
        this.next();
        if (this.isPunct(")")) break;
        items.push(this.parseSpaceList());
      }
      const close = this.expectPunct(")");
      return {
        type: "list",
        separator: ",",
        items,
        brackets: false,
        parens: true,
        start: open.start,
        end: close.end,
      };
    }
    const close = this.expectPunct(")");
    if (first.type === "list") (first as ListLiteral).parens = true;
    /* Widen the span to the parens so source slicers (quark declaration
     * values) reparse cleanly: `(1 + 2) * 3` must not become `1 + 2) * 3`. */
    first.start = open.start;
    first.end = close.end;
    return first;
  }

  private parseBracketList(): ListLiteral {
    const open = this.expectPunct("[");
    const items: Expression[] = [];
    let separator: "," | " " = " ";
    while (!this.isPunct("]")) {
      items.push(this.parseSpaceList());
      if (this.isPunct(",")) {
        separator = ",";
        this.next();
      }
    }
    const close = this.expectPunct("]");
    return {
      type: "list",
      separator,
      items,
      brackets: true,
      parens: false,
      start: open.start,
      end: close.end,
    };
  }

  private parseInterpolation(): Interpolation {
    const open = this.expectPunct("#{");
    const expression = this.parseValue();
    const close = this.expectPunct("}");
    return {
      type: "interpolation",
      expression,
      start: open.start,
      end: close.end,
    };
  }

  /**
   * Lookahead from the `(` after `if`: does it contain a `:` at paren depth
   * one? Colons nested deeper (maps, nested calls) don't count, and `:`
   * inside strings is part of the string token.
   */
  private ifParensHaveArms(): boolean {
    let depth = 0;
    for (let i = this.pos + 1; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type !== "punct") continue;
      if (t.value === "(" || t.value === "[" || t.value === "#{") {
        depth++;
      } else if (t.value === ")" || t.value === "]" || t.value === "}") {
        depth--;
        if (depth === 0) return false;
      } else if (t.value === ":" && depth === 1) {
        return true;
      }
    }
    return false;
  }

  /** `if(condition: value; condition: value; else: value)` */
  private parseIfFunction(ifTok: Token): IfFunction {
    this.next(); // `if`
    this.expectPunct("(");
    const arms: IfArm[] = [];
    let sawElse = false;
    while (!this.isPunct(")")) {
      const first = this.peek();
      if (!first) this.fail("Unclosed if()");
      if (sawElse) {
        this.fail('"else" must be the last arm in if()', first.start);
      }
      let condition: Expression | null = null;
      if (
        first.type === "ident" &&
        first.value === "else" &&
        this.isPunct(":", 1)
      ) {
        this.next();
        sawElse = true;
      } else {
        condition = this.parseExpr(0);
      }
      this.expectPunct(":");
      arms.push({ condition, value: this.parseValue() });
      if (this.isPunct(";")) this.next();
      else break;
    }
    const close = this.expectPunct(")");
    return { type: "if", arms, start: ifTok.start, end: close.end };
  }

  private parseArguments(): Argument[] {
    this.expectPunct("(");
    const args: Argument[] = [];
    while (!this.isPunct(")")) {
      const startTok = this.peek();
      if (!startTok) this.fail("Unclosed arguments");
      let name: string | null = null;
      if (startTok.type === "variable" && this.isPunct(":", 1)) {
        this.next();
        this.next();
        name = startTok.value;
      }
      const value = this.parseSpaceList();
      let spread = false;
      if (this.isPunct("...")) {
        this.next();
        spread = true;
      }
      args.push({
        type: "argument",
        name,
        value,
        spread,
        start: startTok.start,
        end: this.lastEnd,
      });
      if (this.isPunct(",")) this.next();
      else break;
    }
    this.expectPunct(")");
    return args;
  }

  private makeString(t: Token): Expression {
    const raw = t.value;
    const quote = t.quote ?? '"';
    if (!raw.includes("#{")) {
      return {
        type: "string",
        quote,
        parts: raw.length ? [raw] : [],
        value: raw,
        start: t.start,
        end: t.end,
      };
    }
    // Contents start one char after the opening quote.
    const parts = this.splitInterpolatable(raw, t.start + 1);
    return {
      type: "string",
      quote,
      parts,
      value: null,
      start: t.start,
      end: t.end,
    };
  }

  /**
   * Splits raw text containing `#{...}` into literal parts and parsed
   * interpolation expressions. `baseOffset` is the absolute source offset of
   * `raw[0]` so spans stay correct.
   */
  private splitInterpolatable(
    raw: string,
    baseOffset: number
  ): Array<string | Interpolation> {
    if (!raw.includes("#{")) return raw.length ? [raw] : [];
    const parts: Array<string | Interpolation> = [];
    let lit = 0;
    for (let k = 0; k < raw.length; k++) {
      const c = raw.charCodeAt(k);
      if (c === 92 /* \ */) {
        k++;
        continue;
      }
      if (c === 35 /* # */ && raw.charCodeAt(k + 1) === 123 /* { */) {
        if (k > lit) parts.push(raw.slice(lit, k));
        // Find the balanced close brace, skipping nested strings.
        let depth = 1;
        let j = k + 2;
        while (j < raw.length && depth > 0) {
          const cc = raw.charCodeAt(j);
          if (cc === 123) depth++;
          else if (cc === 125) depth--;
          else if (cc === 34 || cc === 39) {
            j++;
            while (j < raw.length && raw.charCodeAt(j) !== cc) {
              if (raw.charCodeAt(j) === 92) j++;
              j++;
            }
          }
          j++;
        }
        if (depth > 0) {
          this.fail("Unterminated interpolation", baseOffset + k);
        }
        const inner = raw.slice(k + 2, j - 1);
        const innerOffset = baseOffset + k + 2;
        const sub = tokenize(inner);
        for (const tk of sub.tokens) {
          tk.start += innerOffset;
          tk.end += innerOffset;
        }
        const subParser = new Parser(this.source, sub.tokens, []);
        const expression = subParser.parseValue();
        if (!subParser.atEnd()) {
          subParser.fail("Unexpected trailing input in interpolation");
        }
        parts.push({
          type: "interpolation",
          expression,
          start: baseOffset + k,
          end: baseOffset + j,
        });
        k = j - 1;
        lit = j;
      }
    }
    if (lit < raw.length) parts.push(raw.slice(lit));
    return parts;
  }

  /*
   * -------------------------------------------------------------------------
   * At-rules
   * -------------------------------------------------------------------------
   */

  private parseAtRule(): AtRule {
    const at = this.next(); // "at" token
    if (at.value === "off") {
      this.fail(
        '@off is not supported: gate the @on listener with options such as (target: "…") / (key: "…"), or with event data inside its block',
        at.start
      );
    }
    if (!(at.value in AT_RULE_PARSERS)) {
      this.fail(`@${at.value} is not a Quark at-rule`, at.start);
    }
    return AT_RULE_PARSERS[at.value as QuarkAtRuleName](this, at);
  }

  /** `@warn` / `@debug` / `@error`: one value, then `;`. */
  parseValueAtRule(at: Token): ValueAtRule {
    const value = this.parseValue();
    if (this.isPunct(";")) this.next();
    return {
      type: "atrule",
      name: at.value as ValueAtRule["name"],
      value,
      start: at.start,
      end: this.lastEnd,
    };
  }

  /** `@use "url" [as name | as *];`: JS modules only, never configured. */
  parseUseRule(at: Token): UseRule {
    const url = this.expectString().value;
    let namespace: string | null = null;
    if (this.isIdent("as")) {
      this.next();
      if (this.isPunct("*")) {
        this.next();
        namespace = "*";
      } else {
        namespace = this.expectIdent().value;
      }
    }
    if (this.isIdent("with")) {
      this.fail("@use does not take a with clause", this.peek()!.start);
    }
    if (this.isPunct(";")) this.next();
    return {
      type: "atrule",
      name: "use",
      url,
      namespace,
      start: at.start,
      end: this.lastEnd,
    };
  }

  /** `@scope { … }`: no prelude — CSS's `(from) to (limit)` is not Quark. */
  parseScopeRule(at: Token): ScopeRule {
    if (!this.isPunct("{")) {
      this.fail(
        "@scope does not take a prelude: @scope { … }",
        this.peek()?.start ?? at.start
      );
    }
    const block = this.parseBlock();
    return {
      type: "atrule",
      name: "scope",
      block,
      start: at.start,
      end: block.end,
    };
  }

  /**
   * `<name> { "," <name> }` after `@on` / `@dispatch` / `@command`: each
   * name is a bare identifier (`click`, `--refresh`) or a string. At
   * least one.
   */
  private parseNameList(atRule: string): EventName[] {
    const names: EventName[] = [];
    for (;;) {
      const token = this.peek();
      if (!token || (token.type !== "ident" && token.type !== "string")) {
        this.fail(
          names.length
            ? `Expected a name after "," in @${atRule}`
            : `Expected an event name after @${atRule}`,
          token?.start
        );
      }
      this.next();
      names.push({
        type: "event_name",
        name: token.value,
        quoted: token.type === "string",
        start: token.start,
        end: token.end,
      });
      if (!this.isPunct(",")) break;
      this.next();
    }
    return names;
  }

  /**
   * `@on click, submit (debounce: 300, handle: save) { … }`: a comma list
   * of event names (idents or strings), an optional options group, then a
   * block parsed as a plain rule body or `;`. Handlers live in the
   * options group (`handle:`); a bare expression after the events is the
   * removed handler-list form and fails with guidance.
   */
  parseListenerRule(at: Token): ListenerRule {
    const name = "on";
    const events = this.parseNameList(name);
    const options = this.isPunct("(") ? this.parseListenerOptions(name) : [];
    let block: Block | null = null;
    if (this.isPunct("{")) {
      block = this.parseBlock();
    } else if (this.isPunct(";")) {
      this.next();
    } else if (!this.atEnd() && !this.isPunct("}")) {
      this.fail(
        `Unexpected token after @${name} ${events.map((e) => e.name).join(", ")}: handlers go in the options group — @${name} ${events[0].name} (handle: myFn); or @${name} ${events[0].name} (handle: (a, b));`,
        this.peek()?.start
      );
    }
    if (!block && !options.length) {
      this.fail(
        `@${name} ${events.map((e) => e.name).join(", ")} has nothing to do: add an options group such as (handle: myFn) or (prevent-default), or a block`,
        at.start
      );
    }
    return {
      type: "atrule",
      name,
      events,
      options,
      block,
      start: at.start,
      end: block ? block.end : this.lastEnd,
    };
  }

  /**
   * `@dispatch cart-add (detail: (sku: $sku), target: "cart-view");` /
   * `@command --refresh (target: "#feed");`: a comma list of names, an
   * optional options group, then `;`. A block is a parse error.
   */
  parseActionRule(at: Token): ActionRule {
    const name = at.value as ActionRule["name"];
    const names = this.parseNameList(name);
    const options = this.isPunct("(") ? this.parseListenerOptions(name) : [];
    if (this.isPunct("{")) {
      this.fail(
        `@${name} is a statement: @${name} ${names[0].name} (options);`,
        this.peek()?.start
      );
    }
    if (this.isPunct(";")) {
      this.next();
    } else if (!this.atEnd() && !this.isPunct("}")) {
      this.fail(
        `Expected "(" or ";" after @${name} ${names.map((e) => e.name).join(", ")}`,
        this.peek()?.start
      );
    }
    return {
      type: "atrule",
      name,
      names,
      options,
      start: at.start,
      end: this.lastEnd,
    };
  }

  /**
   * `@view-transition (types: "todo", timeout: 500) { … }`: an optional
   * options group (same grammar as `@on`'s), then a required block parsed
   * as a plain rule body.
   */
  parseTransitionRule(at: Token): TransitionRule {
    const name = "view-transition";
    const options = this.isPunct("(") ? this.parseListenerOptions(name) : [];
    if (!this.isPunct("{")) {
      this.fail(
        `@${name} needs a block: @${name} (options) { … }`,
        this.peek()?.start ?? at.start
      );
    }
    const block = this.parseBlock();
    return {
      type: "atrule",
      name,
      options,
      block,
      start: at.start,
      end: block.end,
    };
  }

  /**
   * `@delay 2000 { … }` / `@delay $ms * 2 { … }`: one duration expression
   * (a value, so a comma list parses too — the runtime rejects it), then a
   * required block parsed as an ordinary rule body.
   */
  parseDelayRule(at: Token): DelayRule {
    const name = "delay";
    // a duration may open with a unary sign (`+attr("data-ms") or 1500`)
    if (
      !this.canStartExpression() &&
      !this.isPunct("+") &&
      !this.isPunct("-")
    ) {
      this.fail(
        `Expected a duration after @${name}`,
        this.peek()?.start ?? at.start
      );
    }
    const duration = this.parseValue();
    if (!this.isPunct("{")) {
      this.fail(
        `@${name} needs a block: @${name} <ms> { … }`,
        this.peek()?.start ?? at.start
      );
    }
    const block = this.parseBlock();
    return {
      type: "atrule",
      name,
      duration,
      block,
      start: at.start,
      end: block.end,
    };
  }

  /**
   * `( option { "," option } )` after `@on` / `@dispatch` / `@command`
   * names or `@view-transition`:
   * each option is an ident, optionally followed by `:` and one space-list
   * value (commas separate options, so a value never spans a comma).
   * Duplicate names are a parse error; unknown names are the runtime's
   * business.
   */
  private parseListenerOptions(atRule = "on"): ListenerOption[] {
    const open = this.expectPunct("(");
    const options: ListenerOption[] = [];
    const seen = new Set<string>();
    while (!this.isPunct(")")) {
      const nameToken = this.peek();
      if (!nameToken || nameToken.type !== "ident") {
        this.fail(
          `Expected an option name inside @${atRule} ( … )`,
          nameToken?.start ?? open.start
        );
      }
      this.next();
      if (seen.has(nameToken.value)) {
        this.fail(
          `Duplicate @${atRule} option "${nameToken.value}"`,
          nameToken.start
        );
      }
      seen.add(nameToken.value);
      let value: Expression | null = null;
      if (this.isPunct(":")) {
        this.next();
        if (!this.canStartExpression()) {
          this.fail(
            `Expected a value after @${atRule} option "${nameToken.value}:"`
          );
        }
        value = this.parseSpaceList();
      }
      options.push({
        type: "listener_option",
        name: nameToken.value,
        value,
        start: nameToken.start,
        end: this.lastEnd,
      });
      if (this.isPunct(",")) {
        this.next();
        continue;
      }
      if (!this.isPunct(")")) {
        this.fail(`Expected "," or ")" in @${atRule} ( … )`);
      }
    }
    this.expectPunct(")");
    return options;
  }
}
