import { parentNodeOf, parentOf } from "./parents";
import type { DomWindow } from "./window";

const HTML = "http://www.w3.org/1999/xhtml";

export type Context = {
  /** `:scope`: the element queried / matched, or a document's root element. */
  scope: Node | null;
  /** happy-dom's own `matches()`, for the simple selectors it gets right. */
  matches: (this: Element, selectors: string) => boolean;
  /** The element focus is on in `doc`, if any. */
  focused: (doc: Document) => Element | null;
  /** This call's shared answers, per key: `:has()` steps, sibling positions. */
  memo: Map<object, Map<object, unknown>>;
};
/** A simple selector the shim answers itself, afresh on every call. */
export type Test = (el: Element, ctx: Context) => boolean;
type Position = [fromStart: number, fromEnd: number];

// input types `readonly` / `required` / `placeholder` / range limits apply to
const TEXTUAL = ["text", "search", "url", "tel", "email", "password"];
const DATES = ["date", "month", "week", "time", "datetime-local"];
const READONLY = [...TEXTUAL, ...DATES, "number"];
const REQUIRABLE = [...READONLY, "checkbox", "radio", "file"];
const PLACEHOLDER = [...TEXTUAL, "number"];
const RANGED = [...DATES, "number", "range"];
const CONTROLS = [
  "button",
  "input",
  "select",
  "textarea",
  "optgroup",
  "option",
  "fieldset",
];
/** `:nth-child()` and kin: [counts only the same type, counts from the end]. */
export const STRUCTURAL: Record<string, [ofType: boolean, fromEnd: boolean]> = {
  "nth-child": [false, false],
  "nth-last-child": [false, true],
  "nth-of-type": [true, false],
  "nth-last-of-type": [true, true],
};
// memo keys shared by every structural pseudo-class in a call
const CHILDREN = {};
const TYPES = {};
const ANB =
  /^([+-]?)(\d*)n(?:[ \t\n\r\f]*([+-])[ \t\n\r\f]*(\d+))?$|^([+-]?\d+)$/;
const RTL =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
// elements whose text does not count for an ancestor's `dir="auto"`
const OWN_TEXT = ["bdi", "script", "style", "textarea"];
// dialogs `showModal()` opened, until closed
const modals = new WeakSet<Element>();

export const lower = (text: string) =>
  text.replace(/[A-Z]/g, (char) => char.toLowerCase());
/** `text` without CSS whitespace at its ends: a no-break space stays. */
export const trim = (text: string) =>
  text.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, "");
/** `el`'s tag name when it is an HTML element. */
export const tag = (el: Element) =>
  el.namespaceURI === HTML ? el.localName : "";
/** The first of `el` and its ancestors that passes `test`. */
const ancestor = (
  el: Element | null,
  test: (node: Element) => boolean
): Element | null => (!el || test(el) ? el : ancestor(parentOf(el), test));

/** This call's answers for `key`, by item. */
export const memoOf = (ctx: Context, key: object): Map<object, unknown> =>
  ctx.memo.get(key) ?? ctx.memo.set(key, new Map()).get(key)!;
/** `compute()` once per call, key and item. */
export const remember = <T>(
  ctx: Context,
  key: object,
  item: object,
  compute: () => T
): T => {
  const results = memoOf(ctx, key);
  if (!results.has(item)) results.set(item, compute());
  return results.get(item) as T;
};

const inputType = (el: Element) =>
  tag(el) === "input" ? (el as HTMLInputElement).type : "";
const submits = (el: Element) =>
  tag(el) === "button"
    ? (el as HTMLButtonElement).type === "submit"
    : ["submit", "image"].includes(inputType(el));

/** HTML's "actually disabled": own `disabled`, or a disabled `<optgroup>` (options) / `<fieldset>` (outside its first `<legend>`). */
const disabled = (el: Element): boolean => {
  if (el.hasAttribute("disabled")) return true;
  const parent = parentOf(el);
  if (el.localName === "option")
    return parent?.localName === "optgroup" && parent.hasAttribute("disabled");
  if (el.localName === "optgroup") return false;
  for (let child = el, node = parent; node; child = node, node = parentOf(node))
    if (
      node.localName === "fieldset" &&
      node.hasAttribute("disabled") &&
      child !== [...node.children].find((item) => item.localName === "legend")
    )
      return true;
  return false;
};

/** Whether `el` takes part in constraint validation (`:valid` / `:invalid`). */
const candidate = (el: Element): boolean => {
  const name = tag(el);
  const type = (el as HTMLInputElement).type;
  return (
    ["button", "input", "select", "textarea"].includes(name) &&
    !disabled(el) &&
    !(name === "input" && ["hidden", "reset", "button"].includes(type)) &&
    !(name === "button" && type !== "submit") &&
    !(
      (name === "textarea" || READONLY.includes(inputType(el))) &&
      el.hasAttribute("readonly")
    ) &&
    !ancestor(parentOf(el), (node) => tag(node) === "datalist")
  );
};
const invalid = (el: Element): boolean =>
  ["form", "fieldset"].includes(tag(el))
    ? [...(el as HTMLFormElement).elements].some(invalid)
    : candidate(el) && !(el as HTMLInputElement).validity.valid;
const ranged = (el: Element) =>
  RANGED.includes(inputType(el)) &&
  candidate(el) &&
  (inputType(el) === "range" ||
    el.hasAttribute("min") ||
    el.hasAttribute("max"));
const outOfRange = (el: Element) => {
  const { validity } = el as HTMLInputElement;
  return validity.rangeUnderflow || validity.rangeOverflow;
};
/** The other radios of `radio`'s group: same name, same form owner. */
const group = (radio: HTMLInputElement): HTMLInputElement[] =>
  radio.name
    ? [
        ...(radio.form?.elements ??
          (radio.getRootNode() as ParentNode).querySelectorAll("input")),
      ].filter(
        (other): other is HTMLInputElement =>
          inputType(other) === "radio" &&
          (other as HTMLInputElement).name === radio.name &&
          (other as HTMLInputElement).form === radio.form
      )
    : [];
/** Editable by `contenteditable` on `el` or the nearest ancestor that sets it. */
const editable = (el: Element) => {
  const value = (node: Element) =>
    lower(node.getAttribute("contenteditable") ?? "-");
  const host = ancestor(el, (node) =>
    ["", "true", "false", "plaintext-only"].includes(value(node))
  );
  return !!host && value(host) !== "false";
};
const writable = (el: Element) =>
  tag(el) === "textarea" || READONLY.includes(inputType(el))
    ? !el.hasAttribute("readonly") && !disabled(el)
    : tag(el) !== "input" && editable(el);

/** 1-based positions of `parent`'s children in their group (`null`: not counted). */
const positions = (
  ctx: Context,
  key: object,
  parent: ParentNode,
  groupOf: (el: Element) => string | null
) =>
  remember(ctx, key, parent, () => {
    const groups = new Map<string, Element[]>();
    for (const child of parent.children) {
      const name = groupOf(child);
      if (name !== null)
        (groups.get(name) ?? groups.set(name, []).get(name)!).push(child);
    }
    const result = new Map<Element, Position>();
    for (const members of groups.values())
      members.forEach((member, i) =>
        result.set(member, [i + 1, members.length - i])
      );
    return result;
  });
const typeOf = (el: Element) => `${el.namespaceURI} ${el.localName}`;
const everyone = () => "";

/** `An+B` (`odd`, `-n+3`, `5`) as `[A, B]`. */
export const anB = (text: string): [number, number] | undefined => {
  const value = lower(trim(text));
  if (value === "odd") return [2, 1];
  if (value === "even") return [2, 0];
  const [match, sign, a, bSign, b, only] = ANB.exec(value) ?? [];
  if (!match) return undefined;
  return only !== undefined
    ? [0, Number(only)]
    : [Number(`${sign}${a || 1}`), b ? Number(`${bSign}${b}`) : 0];
};

/**
 * `:nth-child()` and kin, for position `An+B` among the siblings (of the
 * same type; that pass `of`).
 */
export const nth = (
  name: string,
  [a, b]: [number, number],
  of?: Test
): Test => {
  const [ofType, fromEnd] = STRUCTURAL[name];
  const key = of ? {} : ofType ? TYPES : CHILDREN;
  return (el, ctx) => {
    const parent = parentNodeOf(el);
    const groupOf = ofType
      ? typeOf
      : of
        ? (node: Element) => (of(node, ctx) ? "" : null)
        : everyone;
    const index =
      (parent && positions(ctx, key, parent, groupOf).get(el))?.[
        fromEnd ? 1 : 0
      ] ?? 0;
    return (
      index > 0 &&
      (a ? (index - b) / a >= 0 && (index - b) % a === 0 : index === b)
    );
  };
};
/** Whether `el` has a parent and no sibling (of its type) `step` leads to. */
const alone =
  (
    step: "previousElementSibling" | "nextElementSibling",
    ofType: boolean
  ): Test =>
  (el) => {
    for (let sibling = el[step]; sibling; sibling = sibling[step])
      if (!ofType || typeOf(sibling) === typeOf(el)) return false;
    return !!parentNodeOf(el);
  };
const first = alone("previousElementSibling", false);
const last = alone("nextElementSibling", false);
const firstOfType = alone("previousElementSibling", true);
const lastOfType = alone("nextElementSibling", true);

/** RFC 4647 extended filtering: whether `language` is in `range` (`:lang()`). */
const inRange = (language: string, range: string) => {
  const [head, ...rest] = range.split("-");
  const subtags = language.split("-");
  if (!language || (head !== "*" && head !== subtags[0])) return false;
  let i = 1;
  for (const want of rest.filter((subtag) => subtag !== "*")) {
    while (i < subtags.length && subtags[i] !== want && subtags[i].length > 1)
      i++;
    if (subtags[i++] !== want) return false;
  }
  return true;
};

/** `:lang(en, "de-*")`: the language of the nearest `lang`. */
export const language = (argument: string): Test => {
  const ranges = argument
    .split(",")
    .map((range) => lower(trim(range).replace(/^(["'])(.*)\1$/, "$2")));
  return (el) => {
    const lang = ancestor(el, (node) => node.hasAttribute("lang"));
    const value = lower(lang?.getAttribute("lang") ?? "");
    return ranges.some((range) => inRange(value, range));
  };
};

const dir = (node: Element) => lower(node.getAttribute("dir") ?? "");
const DIRS = ["ltr", "rtl", "auto"];
/** The first strong letter of `el`'s text, past elements with their own direction. */
const strong = (el: Element): string | undefined => {
  for (const node of el.childNodes) {
    const letter =
      node.nodeType === 3
        ? /\p{L}/u.exec(node.nodeValue!)?.[0]
        : node.nodeType === 1 &&
            !OWN_TEXT.includes(tag(node as Element)) &&
            !DIRS.includes(dir(node as Element))
          ? strong(node as Element)
          : undefined;
    if (letter) return letter;
  }
  return undefined;
};

/** `:dir(rtl)`: the nearest `dir`; `auto` reads the first strong letter. */
export const direction = (argument: string): Test => {
  const wanted = lower(trim(argument));
  return (el) => {
    const host = ancestor(
      el,
      (node) => DIRS.includes(dir(node)) || tag(node) === "bdi"
    );
    if (!host) return wanted === "ltr";
    if (["ltr", "rtl"].includes(dir(host))) return dir(host) === wanted;
    const letter = strong(host);
    return (letter && RTL.test(letter) ? "rtl" : "ltr") === wanted;
  };
};

const anyLink: Test = (el) =>
  ["a", "area"].includes(tag(el)) && el.hasAttribute("href");
const focus: Test = (el, ctx) => {
  const focused = ctx.focused(el.ownerDocument);
  return !!focused && (el === focused || el === el.ownerDocument.activeElement);
};

/** Pseudo-classes happy-dom lacks, gets wrong or caches stale. */
export const PSEUDO_CLASSES: Record<string, Test> = {
  "first-child": first,
  "last-child": last,
  "only-child": (el, ctx) => first(el, ctx) && last(el, ctx),
  "first-of-type": firstOfType,
  "last-of-type": lastOfType,
  "only-of-type": (el, ctx) => firstOfType(el, ctx) && lastOfType(el, ctx),
  // comments do not count; whitespace does
  empty: (el) =>
    [...el.childNodes].every(
      (node) =>
        node.nodeType !== 1 &&
        !((node.nodeType === 3 || node.nodeType === 4) && node.nodeValue)
    ),
  enabled: (el) => CONTROLS.includes(tag(el)) && !disabled(el),
  disabled: (el) => CONTROLS.includes(tag(el)) && disabled(el),
  checked: (el) =>
    tag(el) === "option"
      ? (el as HTMLOptionElement).selected
      : ["checkbox", "radio"].includes(inputType(el)) &&
        (el as HTMLInputElement).checked,
  default: (el) =>
    ["checkbox", "radio"].includes(inputType(el))
      ? el.hasAttribute("checked")
      : tag(el) === "option"
        ? el.hasAttribute("selected")
        : submits(el) &&
          [...((el as HTMLButtonElement).form?.elements ?? [])].find(
            submits
          ) === el,
  indeterminate: (el) =>
    inputType(el) === "checkbox"
      ? (el as HTMLInputElement).indeterminate
      : inputType(el) === "radio"
        ? !(el as HTMLInputElement).checked &&
          !group(el as HTMLInputElement).some((radio) => radio.checked)
        : tag(el) === "progress" && !el.hasAttribute("value"),
  required: (el) =>
    (["select", "textarea"].includes(tag(el)) ||
      REQUIRABLE.includes(inputType(el))) &&
    el.hasAttribute("required"),
  optional: (el) =>
    ["input", "select", "textarea"].includes(tag(el)) &&
    !(
      (tag(el) !== "input" || REQUIRABLE.includes(inputType(el))) &&
      el.hasAttribute("required")
    ),
  "read-write": writable,
  "read-only": (el) => !writable(el),
  "placeholder-shown": (el) =>
    (tag(el) === "textarea" || PLACEHOLDER.includes(inputType(el))) &&
    !!el.getAttribute("placeholder") &&
    !(el as HTMLInputElement).value,
  valid: (el) =>
    (["form", "fieldset"].includes(tag(el)) || candidate(el)) && !invalid(el),
  invalid,
  "in-range": (el) => ranged(el) && !outOfRange(el),
  "out-of-range": (el) => ranged(el) && outOfRange(el),
  "any-link": anyLink,
  "-webkit-any-link": anyLink,
  // no history: every link is unvisited
  link: anyLink,
  // built-in elements are defined; custom ones once upgraded
  defined: (el) => {
    if (!tag(el) || !el.localName.includes("-")) return true;
    const definition = el.ownerDocument.defaultView?.customElements.get(
      el.localName
    );
    return !!definition && el instanceof definition;
  },
  open: (el) =>
    ["details", "dialog"].includes(tag(el)) && el.hasAttribute("open"),
  // until close(), whatever happens to `open`
  modal: (el) => modals.has(el),
  focus,
  // as focus: no keyboard to tell the two apart
  "focus-visible": focus,
  "focus-within": (el, ctx) => {
    const focused = ctx.focused(el.ownerDocument);
    return (
      !!focused &&
      (el.contains(focused) || el.contains(el.ownerDocument.activeElement))
    );
  },
};

/**
 * Dialogs as browsers keep them: `showModal()` makes one modal until
 * `close()` (`:modal`), and opening an open dialog the other way throws.
 * happy-dom's `showModal()` opens a dialog as `show()` does. Installed
 * once, by `supportSelectors`.
 */
export function trackModalDialogs(win: DomWindow | typeof globalThis): void {
  const proto = win.HTMLDialogElement.prototype;
  const { showModal, show, close } = proto;
  const refuse = (method: string, reason: string) =>
    new win.DOMException(
      `Failed to execute '${method}' on 'HTMLDialogElement': ${reason}`,
      "InvalidStateError"
    );
  Object.assign(proto, {
    showModal(this: HTMLDialogElement) {
      if (this.hasAttribute("open")) {
        if (modals.has(this)) return;
        throw refuse("showModal", "The dialog is already open.");
      }
      if (!this.isConnected)
        throw refuse("showModal", "The element is not in a Document.");
      showModal.call(this);
      modals.add(this);
    },
    show(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) show.call(this);
      else if (modals.has(this))
        throw refuse("show", "The dialog is already open as a modal.");
    },
    close(this: HTMLDialogElement, returnValue?: string) {
      modals.delete(this);
      close.call(this, returnValue);
    },
  });
}
