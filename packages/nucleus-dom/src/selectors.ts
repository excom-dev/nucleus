import { proxyOf } from "./form-parents";
import { internal, owner } from "./happy-dom";
import { keepParentRead, parentNodeOf, parentOf } from "./parents";
import {
  anB,
  type Context,
  direction,
  language,
  lower,
  memoOf,
  nth,
  PSEUDO_CLASSES,
  remember,
  STRUCTURAL,
  tag,
  type Test,
  trackModalDialogs,
  trim,
} from "./pseudo-classes";
import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/selectors");
// bounded, oldest out: generated selectors (kit-utils' scope markers) never repeat
const MAX_PLANS = 1000;
// parse outcome: happy-dom answers (or rejects) the selector as written
const NATIVE = "native";
// parse outcome: browsers reject the selector
const INVALID = "invalid";

type Combinator = " " | ">" | "+" | "~";
/** A compound: canonical text happy-dom matches, and the shim's tests. */
type Compound = { native: string; tests: Test[] };
/** A compound, the combinator before it and its memo keys for a call. */
type Link = {
  combinator: Combinator;
  compound: Compound;
  memo: [match: object, around: object];
};
type Complex = Link[];
type Plan = {
  list: Complex[];
  /** Native text of the subjects' compounds: what narrows a query. */
  candidates: string;
  /** Canonical text of the whole list, for happy-dom. */
  text: string;
  /** happy-dom answers document and fragment queries right. */
  native: boolean;
  /** No combinators: happy-dom answers every call right, and fresh. */
  compound: boolean;
};
type Simple = { text: string; pseudo?: string; argument?: string };
type Token = Simple | Combinator | ",";
type Query<T> = (this: ParentNode, selectors: string) => T;
type HostTest = Test & { host: (el: Element, ctx: Context) => boolean };

// CSS whitespace: a no-break space is an identifier character
const WS = String.raw`[ \t\n\r\f]`;
const HEX = String.raw`[\da-fA-F]`;
// escapes made disjoint, so a failed match never backtracks through them
const IDENT = String.raw`(?:[\w-]|[^\x00-\x7f]|\\(?:${HEX}{6}(?:${WS}|(?!${WS}))|${HEX}{1,5}(?:${WS}|(?!${HEX}|${WS}))|[^\n\da-fA-F]))+`;
const TOKEN = new RegExp(
  String.raw`${WS}*([>+~,])${WS}*|(${WS}+)|(\[)|(::?)?(\*|[#.]?${IDENT})`,
  "y"
);
const STRING = /"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/y;
const ATTRIBUTE = new RegExp(
  String.raw`^\[${WS}*(${IDENT})${WS}*(?:([~|^$*]?=)${WS}*(?:"((?:[^"\\\n]|\\[\s\S])*)"|'((?:[^'\\\n]|\\[\s\S])*)'|(${IDENT}))${WS}*(?:([iIsS])${WS}*)?)?\]$`
);
const ESCAPE = new RegExp(String.raw`\\(?:(${HEX}{1,6})${WS}?|([\s\S]))`, "g");
const OF = new RegExp(
  String.raw`^([\s\S]*?)(?:${WS}+of${WS}+([\s\S]*))?$`,
  "i"
);
const CLOSERS: Record<string, string> = { "(": ")", "[": "]" };
const LOGICAL = ["not", "is", "where"];
// HTML attributes whose values match ASCII case-insensitively
const LEGACY = new Set(
  "accept accept-charset align alink axis bgcolor charset checked clear codetype color compact declare defer dir direction disabled enctype face frame hreflang http-equiv lang language link media method multiple nohref noresize noshade nowrap readonly rel rev rules scope scrolling selected shape target text type valign valuetype vlink".split(
    " "
  )
);
// pseudo-classes Chrome knows and the shim leaves to happy-dom
const KNOWN = new Set(
  "root target target-current hover active visited autofill -webkit-autofill user-valid user-invalid fullscreen -webkit-full-screen -webkit-full-screen-ancestor -webkit-full-screen-document picture-in-picture popover-open has-slotted current past future playing paused seeking buffering stalled muted volume-locked xr-overlay active-view-transition window-inactive -webkit-drag".split(
    " "
  )
);
const FUNCTIONS = [
  "host-context",
  "state",
  "active-view-transition-type",
  "-webkit-any",
  "current",
];
// pseudo-elements a single colon may write, which match nothing here
const ELEMENTS = ["before", "after", "first-line", "first-letter"];
const OPERATORS: Record<string, (actual: string, value: string) => boolean> = {
  "=": (actual, value) => actual === value,
  "~=": (actual, value) =>
    !!value &&
    !/[ \t\n\f\r]/.test(value) &&
    actual.split(/[ \t\n\f\r]+/).includes(value),
  "|=": (actual, value) => actual === value || actual.startsWith(`${value}-`),
  "^=": (actual, value) => !!value && actual.startsWith(value),
  "$=": (actual, value) => !!value && actual.endsWith(value),
  "*=": (actual, value) => !!value && actual.includes(value),
};
const INTERFACES: Record<number, string> = {
  9: "Document",
  11: "DocumentFragment",
};

const unsupported = (): never => {
  throw NATIVE;
};
/** Escapes as CSS reads them: zero, surrogates and beyond U+10FFFF are U+FFFD. */
const decode = (text: string) =>
  text.replace(ESCAPE, (_, hex: string | undefined, char: string) => {
    if (hex === undefined) return char;
    const code = Number.parseInt(hex, 16);
    const valid = code && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return String.fromCodePoint(valid ? code : 0xfffd);
  });
const scope: Test = (el, ctx) => el === ctx.scope;
const never: Test = () => false;
/** `:host` / `:host(S)`: only a shadow host, met from inside its tree. */
const hostTest = (list?: Complex[]): HostTest =>
  Object.assign(() => false, {
    host: (el: Element, ctx: Context) => !list || matchList(el, list, ctx),
  });

/** Index past the bracket closing the one at `open`, skipping strings and escapes. */
const closing = (text: string, open: number): number => {
  const expected: string[] = [];
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === '"' || char === "'") {
      STRING.lastIndex = i;
      if (!STRING.test(text)) break;
      i = STRING.lastIndex - 1;
    } else if (CLOSERS[char]) expected.push(CLOSERS[char]);
    else if (char === ")" || char === "]") {
      if (expected.pop() !== char) break;
      if (!expected.length) return i + 1;
    }
  }
  return unsupported();
};

/** `text`'s simple selectors, combinators and commas, top level only. */
const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  for (let i = 0; i < text.length; ) {
    TOKEN.lastIndex = i;
    const [match, combinator, space, bracket, colons, name] =
      TOKEN.exec(text) ?? unsupported();
    const end = i + match.length;
    if (combinator || space) {
      tokens.push((combinator ?? " ") as Combinator | ",");
      i = end;
      continue;
    }
    const close = bracket
      ? closing(text, i)
      : text[end] === "("
        ? closing(text, end)
        : end;
    tokens.push({
      text: text.slice(i, close),
      pseudo: colons === ":" ? lower(name) : undefined,
      argument:
        close > end && !bracket ? text.slice(end + 1, close - 1) : undefined,
    });
    i = close;
  }
  return tokens;
};

/**
 * An attribute selector as canonical text where happy-dom gets it right
 * (presence, `=` and a non-empty `^=` / `$=` / `*=`, case-sensitive, plain
 * name, quotable value), else as a test.
 */
const attribute = (text: string): string | Test => {
  const [, raw, operator = "", double, single, ident, flag = ""] =
    ATTRIBUTE.exec(text) ?? unsupported();
  if (lower(flag) === "s") throw INVALID;
  const name = decode(raw);
  const value = decode(double ?? single ?? ident ?? "");
  const legacy = LEGACY.has(lower(name));
  const quote = !/["\\\n]/.test(value)
    ? '"'
    : !/['\\\n]/.test(value)
      ? "'"
      : "";
  const plain =
    !operator ||
    (!flag &&
      !legacy &&
      (operator === "=" || (!!value && /^[\^$*]/.test(operator))));
  if (plain && quote && /^[\w-]+$/.test(name))
    return operator
      ? `[${name}${operator}${quote}${value}${quote}]`
      : `[${name}]`;
  return (el) => {
    const actual = el.getAttribute(name);
    if (actual === null || !operator) return actual !== null;
    const fold = !!flag || (legacy && !!tag(el));
    return OPERATORS[operator](
      fold ? lower(actual) : actual,
      fold ? lower(value) : value
    );
  };
};

const matchCompound = (
  el: Element,
  { native, tests }: Compound,
  ctx: Context
) =>
  (!native || ctx.matches.call(el, native)) &&
  tests.every((test) => test(el, ctx));

/** Whether `el` is the subject of `steps` up to `i`: right to left, as browsers match. */
const back = (el: Element, steps: Complex, i: number, ctx: Context): boolean =>
  remember(
    ctx,
    steps[i].memo[0],
    el,
    () =>
      matchCompound(el, steps[i].compound, ctx) &&
      (!i || left(el, steps, i, ctx))
  );

/** Whether an element `steps[i]`'s combinator leads to from `el`, leftward, is the subject up to `i - 1`. */
const left = (
  el: Element,
  steps: Complex,
  i: number,
  ctx: Context
): boolean => {
  const { combinator, memo } = steps[i];
  const prior = (from: Element) => back(from, steps, i - 1, ctx);
  const parent = parentOf(el);
  switch (combinator) {
    case ">":
      return parent ? prior(parent) : crossHost(el, steps, i, ctx);
    case "+": {
      const sibling = el.previousElementSibling;
      return !!sibling && prior(sibling);
    }
    case " ":
      return remember(ctx, memo[1], el, () =>
        parent
          ? prior(parent) || left(parent, steps, i, ctx)
          : crossHost(el, steps, i, ctx)
      );
    case "~":
      return around(ctx, memo[1], el, prior, false);
  }
};

/** Whether `steps` is `:host` / `:host(S)` alone before a top-level child `el` of a shadow tree. */
const crossHost = (el: Element, steps: Complex, i: number, ctx: Context) => {
  const root = parentNodeOf(el) as ShadowRoot | null;
  const { native, tests } = steps[0].compound;
  return (
    i === 1 &&
    !!root?.host &&
    !native &&
    tests.every(
      (test) => "host" in test && (test as HostTest).host(root.host, ctx)
    )
  );
};

/** Whether a sibling before `el` (after it, `after`) passes `test`; a run of siblings is read once per call. */
const around = (
  ctx: Context,
  key: object,
  el: Element,
  test: (sibling: Element) => boolean,
  after: boolean
): boolean => {
  const results = memoOf(ctx, key);
  if (!results.has(el)) {
    const run = [...(parentNodeOf(el)?.children ?? [el])];
    (after ? run.reverse() : run).reduce((found, sibling) => {
      results.set(sibling, found);
      return found || test(sibling);
    }, false);
  }
  return results.get(el) as boolean;
};

const matchList = (el: Element, list: Complex[], ctx: Context) =>
  list.some((steps) => back(el, steps, steps.length - 1, ctx));

/** Whether `el` starts a match of `steps` from `i` on: left to right, for `:has()`. */
const forward = (
  el: Element,
  steps: Complex,
  i: number,
  ctx: Context
): boolean =>
  remember(
    ctx,
    steps[i].memo[0],
    el,
    () =>
      matchCompound(el, steps[i].compound, ctx) &&
      (i === steps.length - 1 || reach(el, steps, i + 1, ctx))
  );

/** Whether an element `steps[i]`'s combinator leads to from `el`, rightward or down, starts a match from `i`. */
const reach = (
  el: Element,
  steps: Complex,
  i: number,
  ctx: Context
): boolean => {
  const { combinator, memo } = steps[i];
  const starts = (to: Element) => forward(to, steps, i, ctx);
  switch (combinator) {
    case ">":
      return [...el.children].some(starts);
    case "+": {
      const sibling = el.nextElementSibling;
      return !!sibling && starts(sibling);
    }
    case " ":
      return remember(ctx, memo[1], el, () =>
        [...el.children].some(
          (child) => starts(child) || reach(child, steps, i, ctx)
        )
      );
    case "~":
      return around(ctx, memo[1], el, starts, true);
  }
};

/**
 * A list's complex selectors; relative ones (`:has()`) may lead with a
 * combinator. A forgiving list (`:is()`, `:where()`) drops an invalid one.
 */
const parseList = (
  text: string,
  relative: boolean,
  inHas: boolean,
  forgiving: boolean
): Complex[] => {
  const tokens = tokenize(trim(text));
  const commas = tokens.flatMap((token, i) => (token === "," ? [i] : []));
  return [-1, ...commas].flatMap((comma, n) => {
    try {
      return [
        parseComplex(
          tokens.slice(comma + 1, commas[n] ?? tokens.length) as (
            | Simple
            | Combinator
          )[],
          relative,
          inHas
        ),
      ];
    } catch (error) {
      if (forgiving && error === INVALID) return [];
      throw error;
    }
  });
};

const parseComplex = (
  tokens: (Simple | Combinator)[],
  relative: boolean,
  inHas: boolean
): Complex => {
  const steps: { combinator: Combinator; simples: Simple[] }[] = [
    { combinator: " ", simples: [] },
  ];
  for (const token of tokens) {
    const last = steps[steps.length - 1];
    if (typeof token !== "string") last.simples.push(token);
    else if (last.simples.length)
      steps.push({ combinator: token, simples: [] });
    // one leading combinator, in a relative selector only
    else if (relative && steps.length === 1 && last.combinator === " ")
      last.combinator = token;
    else throw INVALID;
  }
  if (steps.some(({ simples }) => !simples.length)) throw INVALID;
  return steps.map(({ combinator, simples }) => {
    const parts = simples.map((simple) => classify(simple, inHas));
    return {
      combinator,
      compound: {
        native: parts.filter((part) => typeof part === "string").join(""),
        tests: parts.filter((part) => typeof part === "function"),
      },
      memo: [{}, {}],
    };
  });
};

/** A simple selector as canonical text for happy-dom, or a test of the shim's own. */
const classify = (
  { text, pseudo, argument }: Simple,
  inHas: boolean
): string | Test => {
  if (text[0] === "[") return attribute(text);
  if (pseudo === undefined) {
    // happy-dom misreads escapes (`#\31 x`) and splits at any space (`ul\u00a0li`)
    if (!/[\s\\]/.test(text) || text.startsWith("::")) return text;
    const name = decode(text.replace(/^[#.]/, ""));
    if (text[0] === "#") return (el) => el.id === name;
    if (text[0] === ".") return (el) => el.classList.contains(name);
    return (el) =>
      tag(el) ? lower(el.localName) === lower(name) : el.localName === name;
  }
  if (argument === undefined) {
    if (pseudo === "scope") return scope;
    if (pseudo === "host") return hostTest();
    if (Object.hasOwn(PSEUDO_CLASSES, pseudo)) return PSEUDO_CLASSES[pseudo];
    if (ELEMENTS.includes(pseudo)) return `::${pseudo}`;
    if (KNOWN.has(pseudo)) return `:${pseudo}`;
    throw INVALID;
  }
  if (pseudo === "has") {
    if (inHas) throw INVALID;
    // never happy-dom's: its `matches()` caches the answer per element and
    // misses a change below it
    const relatives = parseList(argument, true, true, false);
    return (el, ctx) => relatives.some((steps) => reach(el, steps, 0, ctx));
  }
  if (pseudo === "host") {
    const list = parseList(argument, false, inHas, false);
    if (list.length !== 1 || list[0].length !== 1) throw INVALID;
    return hostTest(list);
  }
  if (pseudo === "lang" || pseudo === "dir") {
    if (!trim(argument)) throw INVALID;
    return (pseudo === "lang" ? language : direction)(argument);
  }
  if (Object.hasOwn(STRUCTURAL, pseudo)) {
    const [, formula, of] = OF.exec(trim(argument))!;
    const anb = anB(formula);
    // Chrome rejects a bad `An+B`, and `of S` on the `-of-type` ones
    if (!anb || (of !== undefined && pseudo.endsWith("type"))) throw INVALID;
    const list =
      of === undefined ? undefined : parseList(of, false, inHas, false);
    return nth(pseudo, anb, list && ((el, ctx) => matchList(el, list, ctx)));
  }
  if (LOGICAL.includes(pseudo)) {
    const list = parseList(argument, false, inHas, pseudo !== "not");
    if (!list.length) return never;
    const native = list.map((steps) => steps[0].compound.native).join(", ");
    // happy-dom gets a list of plain compounds right, unless a paren in a
    // string or a zero-weight `:where()` inside trips it
    const plain =
      list.every(
        (steps) => steps.length === 1 && !steps[0].compound.tests.length
      ) && !/"[^"]*[()]|'[^']*[()]|:where\(/.test(native);
    if (plain) return `:${pseudo}(${native})`;
    return pseudo === "not"
      ? (el, ctx) => !matchList(el, list, ctx)
      : (el, ctx) => matchList(el, list, ctx);
  }
  if (FUNCTIONS.includes(pseudo))
    return `:${pseudo}(${argument.replace(/[\t\n\r\f]/g, " ")})`;
  throw INVALID;
};

/** How `selectors` are answered: a plan, happy-dom as written, or a SyntaxError. */
const compile = (selectors: string): Plan | typeof NATIVE | typeof INVALID => {
  try {
    const list = parseList(selectors, false, false, false);
    const subjects = list.map(
      (steps) => steps[steps.length - 1].compound.native || "*"
    );
    return {
      list,
      candidates: subjects.includes("*") ? "*" : subjects.join(", "),
      text: list
        .map((steps) =>
          steps
            .map(
              ({ combinator, compound }, i) =>
                `${!i ? "" : combinator === " " ? " " : ` ${combinator} `}${compound.native}`
            )
            .join("")
        )
        .join(", "),
      // happy-dom's queries misorder and drop matches of sibling combinators
      native: list.every((steps) =>
        steps.every(
          ({ combinator, compound }) =>
            !compound.tests.length && combinator !== "+" && combinator !== "~"
        )
      ),
      compound: list.every((steps) => steps.length === 1),
    };
  } catch (error) {
    // what the parser cannot read stays happy-dom's
    return error === INVALID ? INVALID : NATIVE;
  }
};

const plans = new Map<string, Plan | typeof NATIVE | typeof INVALID>();
const learn = (selectors: string) => {
  // full: the oldest goes, and costs one parse if it comes back
  if (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value!);
  const plan = compile(selectors);
  plans.set(selectors, plan);
  return plan;
};

/** The shim's plan for `selectors`; `null` for happy-dom as written. */
const planFor = (
  node: Node,
  method: string,
  selectors: unknown
): Plan | null => {
  const plan =
    typeof selectors === "string"
      ? (plans.get(selectors) ?? learn(selectors))
      : NATIVE;
  if (plan === NATIVE) return null;
  if (plan !== INVALID) return plan;
  // what a browser throws: a DOMException named SyntaxError
  const [holder, key] = internal(node, "window");
  throw new (holder[key] as typeof globalThis).DOMException(
    `Failed to execute '${method}' on '${INTERFACES[node.nodeType] ?? "Element"}': '${selectors}' is not a valid selector.`,
    "SyntaxError"
  );
};

/**
 * Selectors as browsers match them, in `matches()`, `closest()` and
 * `querySelector(All)()` of elements, documents and fragments, answered
 * afresh after every change. The shim answers what happy-dom gets wrong or
 * caches stale: combinators, complex selectors and lists in `:not()` /
 * `:is()` / `:where()`, `:has()`, `:scope`, `:host`, structural and form
 * pseudo-classes, `:empty`, `:defined`, `:lang()`, `:dir()`, links, focus,
 * attribute operators, flags and escapes. A query matches against the
 * element's whole tree and returns a `NodeList`. An invalid selector throws
 * a `SyntaxError` DOMException, as in Chrome. Other selectors stay
 * happy-dom's.
 */
export function supportSelectors(win: DomWindow | typeof globalThis): void {
  const element = win.Element.prototype;
  // happy-dom shares its classes between windows: one install for all
  if (!claim(element, SHIMMED)) return;
  const fragment = owner(win.DocumentFragment.prototype, "querySelectorAll");
  const protos = [
    element,
    owner(win.Document.prototype, "querySelectorAll"),
    fragment,
  ];
  trackModalDialogs(win);
  keepParentRead(win);
  const { matches } = element;
  // a form / select runs these on the object behind the proxy its tree holds
  const proxy = proxyOf(win);
  // the focused element itself: happy-dom's `activeElement` falls back to body
  const [, active] = internal(win.document, "activeElement");
  // a NodeList of the window's own: one its query on an empty fragment returns, filled
  const empty = fragment.querySelectorAll as Query<NodeList>;
  const probe = win.document.createElement("p") as unknown as Record<
    symbol,
    object
  >;
  const [, items] = internal(probe[internal(probe, "attributes")[1]], "items");
  const listOf = (node: Node, elements: Element[]) => {
    const doc = node.ownerDocument ?? (node as Document);
    const list = empty.call(doc.createDocumentFragment(), "*");
    const store = (list as unknown as Record<symbol, Element[]>)[items];
    for (const el of elements) store.push(el);
    return list;
  };
  const context = (scope: Node | null): Context => ({
    scope,
    matches,
    focused: (doc) =>
      (doc as unknown as Record<symbol, Element | undefined>)[active] ?? null,
    memo: new Map(),
  });

  for (const proto of protos) {
    const { querySelector, querySelectorAll } = proto as {
      querySelector: Query<Element | null>;
      querySelectorAll: Query<ArrayLike<Element>>;
    };
    // an element's own query sees only its subtree: a compound alone
    const native = (plan: Plan) =>
      plan.native && (proto !== element || plan.compound);
    /** happy-dom's own query of `plan`'s subjects under `root` (document order), and their test. */
    const narrow = (root: ParentNode, plan: Plan) => {
      const ctx = context((root as Document).documentElement ?? proxy(root));
      return [
        [...querySelectorAll.call(root, plan.candidates)],
        (el: Element) => matchList(el, plan.list, ctx),
      ] as const;
    };
    Object.assign(proto, {
      querySelector(this: ParentNode & Node, selectors: string) {
        const plan = planFor(this, "querySelector", selectors);
        if (!plan || native(plan))
          return querySelector.call(this, plan?.text ?? selectors);
        const [candidates, test] = narrow(this, plan);
        return candidates.find(test) ?? null;
      },
      querySelectorAll(this: ParentNode & Node, selectors: string) {
        const plan = planFor(this, "querySelectorAll", selectors);
        if (!plan || native(plan))
          return querySelectorAll.call(this, plan?.text ?? selectors);
        const [candidates, test] = narrow(this, plan);
        return listOf(this, candidates.filter(test));
      },
    });
  }
  Object.assign(element, {
    matches(this: Element, selectors: string) {
      const plan = planFor(this, "matches", selectors);
      if (!plan || (plan.native && plan.compound))
        return matches.call(this, plan?.text ?? selectors);
      const self = proxy(this);
      return matchList(self, plan.list, context(self));
    },
    closest(this: Element, selectors: string) {
      const plan = planFor(this, "closest", selectors);
      // happy-dom's own climbs by the public `parentElement`: its matching, the shim's walk
      if (!plan || (plan.native && plan.compound)) {
        const text = plan?.text ?? selectors;
        for (let el: Element | null = this; el; el = parentOf(el))
          if (matches.call(el, text)) return el;
        return null;
      }
      const ctx = context(proxy(this));
      for (let el: Element | null = proxy(this); el; el = parentOf(el))
        if (matchList(el, plan.list, ctx)) return el;
      return null;
    },
  });
}
