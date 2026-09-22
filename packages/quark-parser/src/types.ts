/**
 * Token and AST node types for the Quark language.
 *
 * Quark is a derivative of CSS: its own at-rules plus the CSS constructs
 * the engine runs, with two accessors CSS does not have:
 *   - dot accessor:      `$obj.field`, `prop("provision").body`, `item.name`
 *   - bracket accessor:  `$obj["field"]`, `$tags[$index]`
 *
 * This is a real AST: expressions are structured nodes, not token soup, and
 * whitespace and punctuation are not represented.
 */

/** Numeric offsets into the original source string. */
export interface Span {
  start: number;
  end: number;
}

/*
 * ---------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------------
 */

export type TokenType =
  | "ident"
  | "variable"
  | "at"
  | "string"
  | "number"
  | "hash"
  | "punct"
  | "url"
  | "comment";

export interface Token extends Span {
  type: TokenType;
  /**
   * ident name / variable name (no `$`) / at-keyword name (no `@`) / raw
   * string contents (no quotes, escapes preserved) / number text (no unit) /
   * hash text (no `#`) / punctuation characters / raw url contents / comment
   * text (no delimiters).
   */
  value: string;
  /** Unit for number tokens (`px`, `%`, `em`, ...). */
  unit?: string;
  /** Quote character for string tokens. */
  quote?: '"' | "'";
  /** Whether whitespace or a comment directly precedes this token. */
  ws: boolean;
}

export interface TokenizeResult {
  tokens: Token[];
  comments: Token[];
}

/*
 * ---------------------------------------------------------------------------
 * Statements
 * ---------------------------------------------------------------------------
 */

export interface BaseNode extends Span {
  type: string;
}

export type Statement = Rule | AtRule | Declaration | CommentNode;

export interface Stylesheet extends BaseNode {
  type: "stylesheet";
  body: Statement[];
}

export interface Block extends BaseNode {
  type: "block";
  body: Statement[];
}

export interface CommentNode extends BaseNode {
  type: "comment";
  text: string;
}

export interface Rule extends BaseNode {
  type: "rule";
  selector: SelectorList;
  block: Block;
}

export interface Declaration extends BaseNode {
  type: "declaration";
  property: Property | Variable;
  value: Expression;
}

export interface Property extends BaseNode {
  type: "property";
  name: string;
}

/*
 * ---------------------------------------------------------------------------
 * Selectors
 * ---------------------------------------------------------------------------
 */

export interface SelectorList extends BaseNode {
  type: "selector_list";
  selectors: Selector[];
}

export interface Selector extends BaseNode {
  type: "selector";
  parts: SelectorPart[];
}

export type SelectorPart =
  | TypeSelector
  | ClassSelector
  | IdSelector
  | AttributeSelector
  | PseudoClassSelector
  | PseudoElementSelector
  | ParentSelector
  | Combinator;

export interface TypeSelector extends BaseNode {
  type: "type_selector";
  /** Tag name or `*`. */
  name: string;
}

export interface ClassSelector extends BaseNode {
  type: "class_selector";
  name: string;
}

export interface IdSelector extends BaseNode {
  type: "id_selector";
  name: string;
}

export interface AttributeSelector extends BaseNode {
  type: "attribute_selector";
  name: string;
  /** `=` `*=` `^=` `$=` `|=` `~=` or `null` for bare `[attr]`. */
  operator: string | null;
  value: Expression | null;
  /** `i` or `s` case-sensitivity modifier. */
  modifier: string | null;
}

export interface PseudoClassSelector extends BaseNode {
  type: "pseudo_class_selector";
  name: string;
  /**
   * Selector list for selector-taking pseudos (`:not`, `:is`, `:where`,
   * `:has`), raw source for the rest (`:nth-child(2n+1)`), `null` when the
   * pseudo has no arguments.
   */
  argument: SelectorList | RawArgument | null;
}

export interface PseudoElementSelector extends BaseNode {
  type: "pseudo_element_selector";
  name: string;
  argument: RawArgument | null;
}

export interface RawArgument extends BaseNode {
  type: "raw";
  value: string;
}

export interface ParentSelector extends BaseNode {
  type: "parent_selector";
  /** Suffix for `&-modifier` style selectors. */
  suffix: string | null;
}

export interface Combinator extends BaseNode {
  type: "combinator";
  value: " " | ">" | "+" | "~";
}

/*
 * ---------------------------------------------------------------------------
 * Expressions
 * ---------------------------------------------------------------------------
 */

export type Expression =
  | StringLiteral
  | NumberLiteral
  | ColorLiteral
  | BooleanLiteral
  | NullLiteral
  | Identifier
  | Variable
  | ParentReference
  | Interpolation
  | Url
  | FunctionCall
  | IfFunction
  | Member
  | IndexAccess
  | Unary
  | Binary
  | ListLiteral
  | MapLiteral;

export interface StringLiteral extends BaseNode {
  type: "string";
  quote: '"' | "'";
  /** Literal text parts (escapes preserved) interleaved with interpolations. */
  parts: Array<string | Interpolation>;
  /** Full contents when the string has no interpolation, else `null`. */
  value: string | null;
}

export interface NumberLiteral extends BaseNode {
  type: "number";
  value: number;
  unit: string | null;
}

/** Hex color, including the `#`. */
export interface ColorLiteral extends BaseNode {
  type: "color";
  value: string;
}

export interface BooleanLiteral extends BaseNode {
  type: "boolean";
  value: boolean;
}

export interface NullLiteral extends BaseNode {
  type: "null";
}

/** Unquoted word: `none`, `solid`, `item`, `index`, ... */
export interface Identifier extends BaseNode {
  type: "identifier";
  name: string;
}

/** `$name` (name stored without the `$`). */
export interface Variable extends BaseNode {
  type: "variable";
  name: string;
}

/** `&` used inside an expression, e.g. `closest(&)`. */
export interface ParentReference extends BaseNode {
  type: "parent_reference";
}

/** `#{expression}` */
export interface Interpolation extends BaseNode {
  type: "interpolation";
  expression: Expression;
}

/** Unquoted `url(...)`. Quoted urls parse as a regular `function` call. */
export interface Url extends BaseNode {
  type: "url";
  parts: Array<string | Interpolation>;
}

export interface FunctionCall extends BaseNode {
  type: "function";
  /** `Member` callees cover namespaced/method calls: `math.div()`, `item.join()`. */
  callee: Identifier | Member | Interpolation;
  args: Argument[];
}

export interface Argument extends BaseNode {
  type: "argument";
  /** Variable name (without `$`) for named arguments: `f($name: v)`. */
  name: string | null;
  value: Expression;
  /** `f($args...)` */
  spread: boolean;
}

/**
 * CSS-style conditional function:
 * `if($cond: a; $other == 1: b; else: c)`.
 *
 * Arms are `condition: value` pairs separated by `;`, evaluated in order;
 * the optional `else` arm (condition `null`) must be last. A colon-less
 * `if(...)` parses as a regular `function` call instead.
 */
export interface IfFunction extends BaseNode {
  type: "if";
  arms: IfArm[];
}

export interface IfArm {
  /** `null` for the `else` arm. */
  condition: Expression | null;
  value: Expression;
}

/** Dot accessor: `$obj.field`, `math.$pi`, `prop("provision").body`. */
export interface Member extends BaseNode {
  type: "member";
  object: Expression;
  property: string;
  /** True for namespaced variables: `math.$pi`. */
  variable: boolean;
}

/** Bracket accessor: `$obj["field"]`, `$list[$i]`. */
export interface IndexAccess extends BaseNode {
  type: "index";
  object: Expression;
  index: Expression;
}

export interface Unary extends BaseNode {
  type: "unary";
  operator: "-" | "+" | "not";
  argument: Expression;
}

export type BinaryOperator =
  | "or"
  | "and"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export interface Binary extends BaseNode {
  type: "binary";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export interface ListLiteral extends BaseNode {
  type: "list";
  separator: "," | " ";
  items: Expression[];
  /** True for square-bracket lists: `[1, 2, 3]`. */
  brackets: boolean;
  /** True when the list was written wrapped in parentheses. */
  parens: boolean;
}

export interface MapLiteral extends BaseNode {
  type: "map";
  entries: MapEntry[];
}

export interface MapEntry {
  key: Expression;
  value: Expression;
}

/*
 * ---------------------------------------------------------------------------
 * At-rules
 * ---------------------------------------------------------------------------
 */

export type AtRule =
  | UseRule
  | ScopeRule
  | ListenerRule
  | ActionRule
  | TransitionRule
  | DelayRule
  | ValueAtRule;

export interface AtRuleBase extends BaseNode {
  type: "atrule";
  name: string;
}

/** `@use "url" [as name | as *];`: a `with (…)` clause is a parse error. */
export interface UseRule extends AtRuleBase {
  name: "use";
  url: string;
  /** `null` = derived from url, `"*"` = global. */
  namespace: string | null;
}

/** `@scope { … }`: anchors its rules to the sheet host. No prelude. */
export interface ScopeRule extends AtRuleBase {
  name: "scope";
  block: Block;
}

/**
 * One entry of an at-rule options group: `once`, `target: "li"`,
 * `debounce: 300`. A bare name is a flag (`true`). Shared by `@on`,
 * `@dispatch`, `@command` and `@view-transition`.
 */
export interface ListenerOption extends BaseNode {
  type: "listener_option";
  name: string;
  /** `null` for a bare flag (`once`, `self`, `prevent-default`, …). */
  value: Expression | null;
}

/**
 * One event or command name in an at-rule's name list (`@on click,
 * submit`, `@dispatch cart-add`, `@command --refresh`): a bare identifier
 * or a quoted string.
 */
export interface EventName extends BaseNode {
  type: "event_name";
  /** The name, without quotes when written as a string. */
  name: string;
  /** True when the name was written as a quoted string. */
  quoted: boolean;
}

/**
 * `@on <event>[, <event>] [(options)] { … }` / `@on <event> (options);`:
 * Quark's listener at-rule. Events are bare identifiers (`click`,
 * `super-form-success`) or strings, comma-separated. An optional
 * parenthesised options group follows (`(target: "li", once, handle:
 * save($draft))`; names are idents, values single expressions; a bare
 * name is a flag). Then either a block — an ordinary rule body the
 * runtime applies once per event — or `;`. A statement without options
 * has nothing to do and is a parse error; a handler list after the
 * events (the pre-2026-09-13 form) is a parse error pointing at
 * `handle:`. `@off` was removed (parse error).
 */
export interface ListenerRule extends AtRuleBase {
  name: "on";
  /** Event types in source order; at least one. */
  events: EventName[];
  /** Options group in source order; empty when absent. */
  options: ListenerOption[];
  /** The `@on` block body, or `null` for the statement form. */
  block: Block | null;
}

/**
 * `@dispatch <event>[, <event>] [(options)];` and `@command <name>[,
 * <name>] [(options)];`: Quark's outgoing-event at-rules, statements only
 * (a block is a parse error). Names follow the `@on` event grammar; the
 * options group is the same node as `@on`'s. The runtime accepts them
 * inside `@on` blocks only.
 */
export interface ActionRule extends AtRuleBase {
  name: "dispatch" | "command";
  /** Event / command names in source order; at least one. */
  names: EventName[];
  /** Options group in source order; empty when absent. */
  options: ListenerOption[];
}

/**
 * `@view-transition [(options)] { … }`: Quark's paint-policy block. The
 * optional options group (`(types: "todo", timeout: 500)`) has the same
 * shape as `@on`'s; the block is an ordinary rule body whose writes the
 * runtime applies inside `document.startViewTransition()`. A block is
 * required.
 */
export interface TransitionRule extends AtRuleBase {
  name: "view-transition";
  /** Options group in source order; empty when absent. */
  options: ListenerOption[];
  block: Block;
}

/**
 * `@delay <ms> { … }`: Quark's deferred-writes at-rule. The duration is
 * one expression (evaluated at runtime, milliseconds); the block is an
 * ordinary rule body the runtime applies once when the timer fires. No
 * statement form: a missing duration or block is a parse error.
 */
export interface DelayRule extends AtRuleBase {
  name: "delay";
  duration: Expression;
  block: Block;
}

/** `@debug`, `@warn`, `@error`. */
export interface ValueAtRule extends AtRuleBase {
  name: "debug" | "warn" | "error";
  value: Expression;
}
