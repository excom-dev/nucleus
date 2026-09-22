/**
 * Printer for the Quark AST.
 *
 * Output conventions match prettier's CSS/SCSS style: two-space indent,
 * one selector per line in multi-selector rules, a single preserved blank
 * line between statement groups, comments kept where they were written
 * (including trailing same-line comments), and an 80-column print width.
 * Statements are built as documents (`doc.ts`): parenthesised groups —
 * maps, call arguments, `if()` arms, `@on` options — break one item per
 * line when they overflow, operator chains and space lists wrap like text,
 * a `key: value` inside them breaks after the colon when even
 * `key: value(` will not fit, and a declaration whose value is a comma
 * list of multi-word items breaks one item per line the way prettier
 * prints `transition` / `grid-template-columns`. Strings, selectors and
 * interpolations never wrap.
 *
 * The two Quark deviations from CSS are printed compactly, exactly as
 * written: dot accessors (`$obj.field`) and bracket accessors
 * (`$obj["field"]`) never receive surrounding whitespace.
 */
import {
  type Doc,
  fill,
  group,
  hardline,
  indent,
  indentIfBreak,
  join,
  line,
  printDoc,
  softline,
} from "./doc";
import type {
  ActionRule,
  Argument,
  AtRule,
  Binary,
  Block,
  CommentNode,
  Declaration,
  DelayRule,
  EventName,
  Expression,
  Interpolation,
  ListenerOption,
  ListenerRule,
  QuarkAtRuleName,
  ScopeRule,
  Selector,
  SelectorList,
  Statement,
  Stylesheet,
  TransitionRule,
  UseRule,
  ValueAtRule,
} from "@excom/quark-parser";
import { parse } from "@excom/quark-parser";

export interface FormatOptions {
  /** Indentation unit. Defaults to two spaces. */
  indent?: string;
}

/** Format Quark source. Throws `QuarkParseError` on invalid input. */
export function format(source: string, options: FormatOptions = {}): string {
  const ast = parse(source);
  const lines = new Printer(source, options.indent ?? "  ").stylesheet(ast);
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

/** Columns per line before a breakable construct wraps (prettier's default). */
const PRINT_WIDTH = 80;

/* Binding powers mirror the parser (`BINARY_BP`); used to re-insert
 * the parentheses the AST no longer carries. */
const BINARY_BP: Record<string, number> = {
  or: 1,
  and: 2,
  "==": 4,
  "!=": 4,
  "<": 5,
  ">": 5,
  "<=": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};
const NOT_BP = 3;
const UNARY_BP = 8;
const POSTFIX_BP = 9;

type AtRulePrinter<N extends QuarkAtRuleName> = (
  printer: Printer,
  node: Extract<AtRule, { name: N }>,
  depth: number
) => string[];

/**
 * One printer per Quark at-rule, keyed by the parser's `QuarkAtRuleName`
 * (`QUARK_AT_RULES`) so the two sets cannot drift: a name the parser adds
 * or drops breaks this table at compile time.
 */
const AT_RULE_PRINTERS: { readonly [N in QuarkAtRuleName]: AtRulePrinter<N> } =
  {
    use: (p, node, depth) => p.useRule(node, depth),
    scope: (p, node, depth) => p.scopeRule(node, depth),
    on: (p, node, depth) => p.listenerRule(node, depth),
    dispatch: (p, node, depth) => p.actionRule(node, depth),
    command: (p, node, depth) => p.actionRule(node, depth),
    "view-transition": (p, node, depth) => p.transitionRule(node, depth),
    delay: (p, node, depth) => p.delayRule(node, depth),
    warn: (p, node, depth) => p.valueAtRule(node, depth),
    debug: (p, node, depth) => p.valueAtRule(node, depth),
    error: (p, node, depth) => p.valueAtRule(node, depth),
  };

/** The table's entries seen through the widest node type they accept. */
type AtRulePrint = (printer: Printer, node: AtRule, depth: number) => string[];

class Printer {
  constructor(
    private source: string,
    private indentUnit: string
  ) {}

  private pad(depth: number): string {
    return this.indentUnit.repeat(depth);
  }

  stylesheet(ast: Stylesheet): string[] {
    return this.body(ast.body, 0);
  }

  /** Lay a statement document out at `depth`, wrapping at the print width. */
  private layout(doc: Doc, depth: number): string[] {
    return printDoc(doc, {
      width: PRINT_WIDTH,
      indentUnit: this.indentUnit,
      rootIndent: this.pad(depth),
    }).split("\n");
  }

  /** Render a document on one line (for contexts that never wrap). */
  private flat(doc: Doc): string {
    return printDoc(doc, {
      width: Infinity,
      indentUnit: this.indentUnit,
      rootIndent: "",
    });
  }

  /*
   * ---------------------------------------------------------------------
   * Statements
   * ---------------------------------------------------------------------
   */

  /**
   * Print a statement list, preserving single blank lines between groups
   * and re-attaching comments that trailed a statement on the same line.
   */
  private body(statements: Statement[], depth: number): string[] {
    const lines: string[] = [];
    let prevEnd = -1;
    for (const node of statements) {
      const gap =
        prevEnd >= 0 ? this.source.slice(prevEnd, node.start) : undefined;
      if (
        node.type === "comment" &&
        gap !== undefined &&
        !gap.includes("\n") &&
        lines.length
      ) {
        // Trailing comment on the same line as the previous statement.
        lines[lines.length - 1] += " " + this.comment(node, depth, true);
        prevEnd = node.end;
        continue;
      }
      if (gap !== undefined && countNewlines(gap) >= 2) {
        lines.push("");
      }
      lines.push(...this.statement(node, depth));
      prevEnd = node.end;
    }
    return lines;
  }

  private statement(node: Statement, depth: number): string[] {
    switch (node.type) {
      case "comment":
        return [this.pad(depth) + this.comment(node, depth, false)];
      case "declaration":
        return this.declaration(node, depth);
      case "rule":
        return this.withBlock(
          this.selectorHead(node.selector),
          node.block,
          depth
        );
      case "atrule":
        return (AT_RULE_PRINTERS[node.name] as AtRulePrint)(this, node, depth);
    }
  }

  /** `head { ...body }` with the head's last line receiving the brace. */
  private withBlock(head: Doc, block: Block, depth: number): string[] {
    const headLines = this.layout([head, " {"], depth);
    const inner = this.body(block.body, depth + 1);
    return [...headLines, ...inner, this.pad(depth) + "}"];
  }

  private declaration(node: Declaration, depth: number): string[] {
    const prop =
      node.property.type === "variable"
        ? "$" + node.property.name
        : node.property.name;
    return this.layout(
      [prop, ": ", this.declarationValue(node.value, prop), ";"],
      depth
    );
  }

  /**
   * prettier's multi-value rule: a top-level comma list whose items are
   * themselves multi-word (`transition: opacity 1s, color 1s`) breaks one
   * item per line; custom properties (`--x`) are exempt.
   */
  private declarationValue(value: Expression, prop: string): Doc {
    if (
      value.type === "list" &&
      value.separator === "," &&
      !value.parens &&
      !value.brackets &&
      !prop.startsWith("--") &&
      value.items.some(isMultiWord)
    ) {
      const items = value.items.map((item) => this.expr(item));
      return indent([hardline, join([",", hardline], items)]);
    }
    return this.expr(value);
  }

  private comment(node: CommentNode, depth: number, trailing: boolean): string {
    if (!node.text.includes("\n")) {
      return "/*" + node.text + "*/";
    }
    if (trailing) return "/*" + node.text + "*/";
    /* Multi-line block comment: shift interior lines from the
     * comment's original column to the current indent. */
    const lineStart = this.source.lastIndexOf("\n", node.start) + 1;
    const originalIndent = this.source
      .slice(lineStart, node.start)
      .match(/^\s*/)![0];
    const shifted = node.text
      .split("\n")
      .map((line, i) => {
        if (i === 0) return line;
        return line.startsWith(originalIndent)
          ? this.pad(depth) + line.slice(originalIndent.length)
          : line;
      })
      .join("\n");
    return "/*" + shifted + "*/";
  }

  /*
   * ---------------------------------------------------------------------
   * At-rules (dispatched through `AT_RULE_PRINTERS`)
   * ---------------------------------------------------------------------
   */

  /** `@use "/x" as ns;` — a `with (…)` configuration is not Quark. */
  useRule(node: UseRule, depth: number): string[] {
    const ns =
      node.namespace === null
        ? ""
        : node.namespace === "*"
          ? " as *"
          : ` as ${node.namespace}`;
    return this.layout(`@use "${node.url}"${ns};`, depth);
  }

  /** `@scope { … }` — block only, no prelude. */
  scopeRule(node: ScopeRule, depth: number): string[] {
    return this.withBlock("@scope", node.block, depth);
  }

  /**
   * `@on input, change (debounce: 300, handle: save) { … }` /
   * `@on submit (prevent-default);`: names as written, options as
   * expressions, then a block like a rule or the statement's `;`.
   */
  listenerRule(node: ListenerRule, depth: number): string[] {
    const head: Doc = [
      "@on ",
      this.nameList(node.events),
      this.optionsGroup(node.options),
    ];
    return node.block
      ? this.withBlock(head, node.block, depth)
      : this.layout([head, ";"], depth);
  }

  /** `@dispatch cart-add (detail: $d, target: "#x");`, statements only. */
  actionRule(node: ActionRule, depth: number): string[] {
    return this.layout(
      [
        `@${node.name} `,
        this.nameList(node.names),
        this.optionsGroup(node.options),
        ";",
      ],
      depth
    );
  }

  /** `@view-transition (types: "t", timeout: 500) { … }`, always a block. */
  transitionRule(node: TransitionRule, depth: number): string[] {
    return this.withBlock(
      ["@view-transition", this.optionsGroup(node.options)],
      node.block,
      depth
    );
  }

  /** `@delay 2000 { … }`: one duration expression, always a block. */
  delayRule(node: DelayRule, depth: number): string[] {
    return this.withBlock(
      ["@delay ", this.expr(node.duration)],
      node.block,
      depth
    );
  }

  /** `@debug` / `@warn` / `@error`, one expression each. */
  valueAtRule(node: ValueAtRule, depth: number): string[] {
    return this.layout([`@${node.name} `, this.expr(node.value), ";"], depth);
  }

  private argument(a: Argument): Doc {
    return [
      a.name ? `$${a.name}: ` : "",
      this.expr(a.value),
      a.spread ? "..." : "",
    ];
  }

  /*
   * ---------------------------------------------------------------------
   * Selectors
   * ---------------------------------------------------------------------
   */

  /** Rule heads put each selector on its own line. */
  private selectorHead(list: SelectorList): Doc {
    return join(
      [",", hardline],
      list.selectors.map((s) => this.selector(s))
    );
  }

  /** `, `-joined, for `:not(...)` and the other selector pseudos. */
  private selectorsInline(list: SelectorList): string {
    return list.selectors.map((s) => this.selector(s)).join(", ");
  }

  private selector(selector: Selector): string {
    let out = "";
    for (const part of selector.parts) {
      switch (part.type) {
        case "combinator":
          out = out === "" ? "" : out + " ";
          if (part.value !== " ") out += part.value + " ";
          break;
        case "type_selector":
          out += part.name;
          break;
        case "class_selector":
          out += "." + part.name;
          break;
        case "id_selector":
          out += "#" + part.name;
          break;
        case "parent_selector":
          out += "&" + (part.suffix ?? "");
          break;
        case "attribute_selector": {
          const value =
            part.operator && part.value
              ? part.operator + this.flat(this.expr(part.value))
              : "";
          const modifier = part.modifier ? " " + part.modifier : "";
          out += `[${part.name}${value}${modifier}]`;
          break;
        }
        case "pseudo_class_selector": {
          let argument = "";
          if (part.argument) {
            argument =
              part.argument.type === "selector_list"
                ? `(${this.selectorsInline(part.argument)})`
                : `(${collapseWs(part.argument.value)})`;
          }
          out += `:${part.name}${argument}`;
          break;
        }
        case "pseudo_element_selector":
          out += `::${part.name}${
            part.argument ? `(${collapseWs(part.argument.value)})` : ""
          }`;
          break;
      }
    }
    return out;
  }

  /*
   * ---------------------------------------------------------------------
   * Expressions
   * ---------------------------------------------------------------------
   */

  private interpolation(node: Interpolation): string {
    return `#{${this.flat(this.expr(node.expression))}}`;
  }

  /** Event / command names as authored: `click, "my:evt", --refresh`. */
  private nameList(names: EventName[]): Doc {
    return join(
      ", ",
      names.map((n) => (n.quoted ? `"${n.name}"` : n.name))
    );
  }

  /**
   * ` (once, target: "li", debounce: 300)` after `@on <event>` or
   * `@view-transition`: flags bare, values as expressions, one per line
   * when the group overflows; an empty group prints nothing.
   */
  private optionsGroup(options: ListenerOption[]): Doc {
    return options.length
      ? [
          " ",
          this.parenGroup(
            options.map((o) =>
              o.value ? this.pair(o.name, this.expr(o.value)) : o.name
            ),
            ","
          ),
        ]
      : "";
  }

  /**
   * `(a, b, c)`: flat when it fits, otherwise one item per line with the
   * delimiters on their own lines. `separator` is `","` / `";"` / `""`.
   */
  private parenGroup(
    items: Doc[],
    separator: string,
    open = "(",
    close = ")"
  ): Doc {
    return group([
      open,
      indent([softline, join([separator, line], items)]),
      softline,
      close,
    ]);
  }

  /**
   * `key: value` inside a paren group (`if()` arms, map entries, `@on`
   * options). prettier's "fluid" assignment layout: the value hugs the key
   * when `key: value(` fits on the line, otherwise the line breaks after the
   * colon and the value is indented.
   */
  private pair(key: Doc, value: Doc): Doc {
    const id = Symbol("pair");
    return group([key, ":", group(indent(line), id), indentIfBreak(value, id)]);
  }

  /**
   * Print an expression. `parentBp`/`side` re-create the parentheses that
   * precedence made necessary in the original source.
   */
  private expr(node: Expression, parentBp = 0, side?: "right"): Doc {
    switch (node.type) {
      case "string": {
        const inner =
          node.value !== null
            ? node.value
            : node.parts
                .map((part) =>
                  typeof part === "string" ? part : this.interpolation(part)
                )
                .join("");
        return node.quote + inner + node.quote;
      }
      case "number":
        return `${node.value}${node.unit ?? ""}`;
      case "color":
        return node.value;
      case "boolean":
        return String(node.value);
      case "null":
        return "null";
      case "identifier":
        return node.name;
      case "variable":
        return "$" + node.name;
      case "parent_reference":
        return "&";
      case "interpolation":
        return this.interpolation(node);
      case "url":
        return `url(${node.parts
          .map((part) =>
            typeof part === "string" ? part : this.interpolation(part)
          )
          .join("")})`;
      case "member":
        return [
          this.expr(node.object, POSTFIX_BP),
          `.${node.variable ? "$" : ""}${node.property}`,
        ];
      case "index":
        return [
          this.expr(node.object, POSTFIX_BP),
          "[",
          this.expr(node.index),
          "]",
        ];
      case "function":
        return [
          this.expr(node.callee),
          node.args.length
            ? this.parenGroup(
                node.args.map((a) => this.argument(a)),
                ","
              )
            : "()",
        ];
      case "if": {
        const arms = node.arms.map((arm) =>
          this.pair(
            arm.condition === null ? "else" : this.expr(arm.condition),
            this.expr(arm.value)
          )
        );
        return ["if", this.parenGroup(arms, ";")];
      }
      case "unary": {
        if (node.operator === "not") {
          const doc: Doc = ["not ", this.expr(node.argument, NOT_BP)];
          return parentBp > NOT_BP ? ["(", doc, ")"] : doc;
        }
        const doc: Doc = [node.operator, this.expr(node.argument, UNARY_BP)];
        // `(-$a).b`: a signed operand of a postfix accessor keeps its parens.
        return parentBp > UNARY_BP ? ["(", doc, ")"] : doc;
      }
      case "binary":
        // `$a and $b or $c` wraps like text, breaking after an operator.
        return group(indent(fill(this.binaryParts(node, parentBp, side))));
      case "list": {
        const items = node.items.map((item) => this.expr(item));
        const separator = node.separator === "," ? "," : "";
        if (node.brackets) return this.parenGroup(items, separator, "[", "]");
        /* A bare comma/space list used as an operand needs parens to
         * keep its grouping against surrounding operators. */
        if (node.parens || parentBp > 0)
          return this.parenGroup(items, separator);
        return group(indent(fill(join([separator, line], items))));
      }
      case "map": {
        const entries = node.entries.map((entry) =>
          this.pair(this.expr(entry.key), this.expr(entry.value))
        );
        return this.parenGroup(entries, ",");
      }
    }
  }

  /**
   * Flatten an operator chain into `fill` parts (`[a and, line, b or, line, c]`).
   * A child that precedence parenthesised in the source becomes one part.
   */
  private binaryParts(node: Binary, parentBp: number, side?: "right"): Doc[] {
    const bp = BINARY_BP[node.operator];
    const parts = this.operandParts(node.left, bp);
    parts[parts.length - 1] = [parts[parts.length - 1], " ", node.operator];
    parts.push(line, ...this.operandParts(node.right, bp, "right"));
    /* Lower-precedence child, or equal precedence on the right of
     * a left-associative operator, was parenthesized in the source. */
    return bp < parentBp || (bp === parentBp && side === "right")
      ? [group(["(", indent([softline, fill(parts)]), softline, ")"])]
      : parts;
  }

  private operandParts(node: Expression, bp: number, side?: "right"): Doc[] {
    return node.type === "binary"
      ? this.binaryParts(node, bp, side)
      : [this.expr(node, bp, side)];
  }
}

/** Space list or operator chain — prettier's "comma group" of several words. */
const isMultiWord = (node: Expression): boolean =>
  (node.type === "list" &&
    node.separator === " " &&
    !node.parens &&
    !node.brackets) ||
  node.type === "binary";

const countNewlines = (text: string): number => text.split("\n").length - 1;

const collapseWs = (text: string): string => text.replace(/\s+/g, " ").trim();
