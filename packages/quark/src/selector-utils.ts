/**
 * Selector string helpers for `Rule`. Uses the `@excom/quark-parser`
 * AST internally (lexing is in quark.ts) so quotes, pseudo args, and
 * interpolations stay structural. In/out are still strings.
 */
import { ATTRIBUTE_BLACKLIST_REGEXES } from "./constants";
import { PSEUDO_CLASS_SUPPORT } from "./language-tables";
import { tc } from "@excom/kit-utils";
import type {
  PseudoClassSelector,
  Selector,
  SelectorList,
  SelectorPart,
  Span,
} from "@excom/quark-parser";
import { parseSelectorList } from "@excom/quark-parser";

/** Spans of every `&` (parent selector), including inside `:not(...)` etc. */
function collectParentRefSpans(list: SelectorList, spans: Span[] = []): Span[] {
  for (const selector of list.selectors) {
    for (const part of selector.parts) {
      if (part.type === "parent_selector") {
        spans.push(part);
      } else if (
        part.type === "pseudo_class_selector" &&
        part.argument?.type === "selector_list"
      ) {
        collectParentRefSpans(part.argument, spans);
      }
    }
  }
  return spans;
}

/**
 * Expand one nested selector against its parent: replace each `&`, or
 * prepend the parent as a descendant if there is none. `&` in attribute
 * strings is left alone.
 */
export function buildSelectorLine(
  selectorLine: string,
  parentSelector: string = ""
) {
  const selector = selectorLine.trim();
  if (!parentSelector || !selector) return selectorLine;
  const spans = collectParentRefSpans(parseSelectorList(selector));
  if (!spans.length) return `${parentSelector} ${selector}`;
  // Splice the parent over each `&` char; suffix text (`&-mod`) is preserved.
  let out = "";
  let prev = 0;
  for (const span of spans) {
    out += selector.slice(prev, span.start) + parentSelector;
    prev = span.start + 1;
  }
  out += selector.slice(prev);
  return out.trim();
}

/**
 * Split a `:scope`-anchored selector into the host compound and the rest.
 * `:scope` is the sheet host (`@scope` root); `matches()` cannot resolve
 * it, so `Rule` matches the compound on the host and the rest on
 * candidates.
 *
 * - `":scope"`            → { hostCompound: "",       rest: "" }
 * - `":scope[is-on]"`     → { hostCompound: "[is-on]", rest: "" }
 * - `":scope main span"`  → { hostCompound: "",       rest: "main span" }
 * - `"main span"`         → { hostCompound: null,     rest: "main span" }
 */
export function splitScopePrefix(selector: string): {
  hostCompound: string | null;
  rest: string;
} {
  const trimmed = selector.trim();
  if (!trimmed.includes(":scope")) return { hostCompound: null, rest: trimmed };
  const parts = parseSelectorList(trimmed).selectors[0].parts;
  let scopeSpan: Span | null = null;
  let compoundEnd = trimmed.length;
  for (const part of parts) {
    if (part.type === "combinator") {
      compoundEnd = part.start;
      break;
    }
    if (part.type === "pseudo_class_selector" && part.name === "scope") {
      scopeSpan = part;
    }
  }
  // `:scope` beyond the first compound is not supported, treat as plain text
  if (!scopeSpan) return { hostCompound: null, rest: trimmed };
  const hostCompound = (
    trimmed.slice(0, scopeSpan.start) +
    trimmed.slice(scopeSpan.end, compoundEnd)
  ).trim();
  return { hostCompound, rest: trimmed.slice(compoundEnd).trim() };
}

/**
 * Where subjects sit relative to the element a dependency was found on:
 * its subtree (`self`) or its parent's (`parent`, sibling combinator).
 */
export type FanOutRoot = "self" | "parent";

/**
 * One selector compound and what can change its match. Attrs are
 * bucketed by *where the change happens* vs the compound's element,
 * which decides where to look for subjects next:
 *
 * - `selfAttrs`: on the compound itself (`[x]`, `:not([x])`,
 *   `:is([x], [y])`, attribute-backed pseudos). Re-run it or fan out
 *   below.
 * - `looseAttrs`: nearby. Earlier compound of a complex `:is()` /
 *   `:not()` (`:is(section[x] li)`), `S` in `:nth-child(… of S)`, or
 *   an ancestor a pseudo inherits from (`fieldset[disabled]` for
 *   `:disabled`). Fan out from the changed element (or its parent).
 * - `hasAttrs`: on a descendant named in `:has()`. Walk up.
 * - `broadAttrs`: anywhere in the host. Sibling `:has(+ …)` /
 *   `:has(~ …)`, earlier compounds of a complex `:has()`, or `:has()`
 *   nested in a complex logical arg. Fan out from the host.
 */
export interface CompoundDependency {
  /** Index of the compound in `path` (combinators are separate entries). */
  pathIndex: number;
  /**
   * `path[0..pathIndex]` joined: what an element must match to be this
   * compound. For the subject, the whole selector.
   */
  prefix: string;
  /**
   * Prefix starts with a combinator (`> span` after `:scope`); only
   * valid once the host marker is prepended. Other prefixes match
   * unscoped (cheaper); fan-out is clamped to the host anyway.
   */
  prefixNeedsScope: boolean;
  isSubject: boolean;
  /** Fan-out root for changes on the compound's element (or a `:has()` ancestor). */
  root: FanOutRoot;
  /** Fan-out root for `looseAttrs` changes. */
  looseRoot: FanOutRoot;
  selfAttrs: Set<string>;
  looseAttrs: Set<string>;
  hasAttrs: Set<string>;
  broadAttrs: Set<string>;
  /** `:has()` / `:empty`: insertions and removals below the element re-check it. */
  reactsToChildren: boolean;
  /** Child changes anywhere in the host re-run the rule from the host. */
  broad: boolean;
  /** Sibling position matters (structural pseudo-class or `of S`). */
  positional: boolean;
  /** An argument uses a sibling combinator. */
  siblingInArgs: boolean;
  /**
   * Class tokens named by `.x` (arguments included), for the observer's
   * `class` filter. `null` when the whole value matters (`[class~="x"]`,
   * an escaped name).
   */
  classNames: Set<string> | null;
}

export interface SelectorAnalysis {
  /** Compounds and combinators in order: `["div:not([x])", ">", "span"]`. */
  path: string[];
  /** Observable attrs the selector depends on (observer input). */
  attrs: Set<string>;
  compounds: CompoundDependency[];
  /** A compound reacts to child insert/remove (`:has()`, `:empty`). */
  usesHas: boolean;
  /** Sibling position matters (structural pseudo, `+` / `~`). */
  positional: boolean;
  /** The sheet must observe child removals for this selector. */
  reactsToRemovals: boolean;
  /** Pseudos the observer cannot follow (`:hover`, `::before`). */
  unobserved: string[];
  /** Union of the compounds' `classNames`; `null` if any is `null`. */
  classNames: Set<string> | null;
}

type Bucket = "self" | "loose" | "has" | "broad";

const BUCKET_FIELD: Record<Bucket, keyof CompoundDependency> = {
  self: "selfAttrs",
  loose: "looseAttrs",
  has: "hasAttrs",
  broad: "broadAttrs",
};

/** Bucket for a compound *before* the last one of an argument arm. */
const earlierBucket = (bucket: Bucket): Bucket =>
  bucket === "self" || bucket === "loose" ? "loose" : "broad";

const newCompound = (
  pathIndex: number,
  prefix: string,
  isSubject: boolean
): CompoundDependency => ({
  pathIndex,
  prefix,
  prefixNeedsScope: /^[>+~]/.test(prefix),
  isSubject,
  root: "self",
  looseRoot: "self",
  selfAttrs: new Set(),
  looseAttrs: new Set(),
  hasAttrs: new Set(),
  broadAttrs: new Set(),
  reactsToChildren: false,
  broad: false,
  positional: false,
  siblingInArgs: false,
  classNames: new Set(),
});

const isSiblingCombinator = (part: SelectorPart | undefined) =>
  part?.type === "combinator" && (part.value === "+" || part.value === "~");

const addAttr = (c: CompoundDependency, bucket: Bucket, name: string) => {
  if (!name || ATTRIBUTE_BLACKLIST_REGEXES.some((re) => re.test(name))) return;
  (c[BUCKET_FIELD[bucket]] as Set<string>).add(name);
};

/** `.x` gates on `class`; the token feeds the observer's class filter. */
const addClassName = (c: CompoundDependency, bucket: Bucket, name: string) => {
  addAttr(c, bucket, "class");
  if (!c.classNames) return;
  // escaped (`.sm\:hidden`): any class change may matter
  if (name.includes("\\")) c.classNames = null;
  else c.classNames.add(name);
};

/** Split an argument arm into its compounds; note sibling combinators. */
const visitArm = (
  arm: Selector,
  c: CompoundDependency,
  bucket: Bucket,
  unobserved: string[]
) => {
  const groups: SelectorPart[][] = [];
  let current: SelectorPart[] = [];
  for (const part of arm.parts) {
    if (part.type === "combinator") {
      if (isSiblingCombinator(part)) c.siblingInArgs = true;
      if (current.length) groups.push(current);
      current = [];
    } else {
      current.push(part);
    }
  }
  if (current.length) groups.push(current);
  groups.forEach((parts, i) => {
    visitCompound(
      parts,
      c,
      i === groups.length - 1 ? bucket : earlierBucket(bucket),
      unobserved
    );
  });
};

const visitPseudo = (
  part: PseudoClassSelector,
  c: CompoundDependency,
  bucket: Bucket,
  unobserved: string[]
) => {
  const doc = PSEUDO_CLASS_SUPPORT[part.name];
  const arms =
    part.argument?.type === "selector_list" ? part.argument.selectors : [];
  switch (doc?.kind) {
    case "logical":
      arms.forEach((arm) => visitArm(arm, c, bucket, unobserved));
      break;
    case "relational":
      c.reactsToChildren = true;
      arms.forEach((arm) => {
        // `:has(+ x)` looks sideways, and a `:has()` nested in another
        // argument has no prefix to walk up with: both fan out from the host
        const armBucket: Bucket =
          isSiblingCombinator(arm.parts[0]) || bucket !== "self"
            ? "broad"
            : "has";
        if (armBucket === "broad") c.broad = true;
        visitArm(arm, c, armBucket, unobserved);
      });
      break;
    case "structural": {
      c.positional = true;
      if (part.name === "empty") c.reactsToChildren = true;
      // `:nth-child(2n+1 of S)`, the attributes of `S` sit on siblings
      const raw = part.argument?.type === "raw" ? part.argument.value : "";
      const ofAt = raw.search(/\bof\b/);
      if (ofAt >= 0) {
        const list = tc(() => parseSelectorList(raw.slice(ofAt + 2).trim())) as
          | SelectorList
          | undefined;
        list?.selectors.forEach((arm) => {
          c.siblingInArgs = true;
          visitArm(arm, c, earlierBucket(bucket), unobserved);
        });
      }
      break;
    }
    case "attribute":
      doc.attributes?.forEach((name) => {
        addAttr(c, bucket, name);
        // inherited state (`fieldset[disabled]`, `lang`) changes above
        if (bucket === "self") addAttr(c, "loose", name);
      });
      break;
    case "static":
      break;
    default:
      unobserved.push(`:${part.name}`);
  }
};

const visitCompound = (
  parts: SelectorPart[],
  c: CompoundDependency,
  bucket: Bucket,
  unobserved: string[]
) => {
  for (const part of parts) {
    if (part.type === "attribute_selector") {
      addAttr(c, bucket, part.name);
      if (part.name === "class") c.classNames = null;
    } else if (part.type === "class_selector") {
      addClassName(c, bucket, part.name);
    } else if (part.type === "id_selector") {
      addAttr(c, bucket, "id");
    } else if (part.type === "pseudo_class_selector") {
      visitPseudo(part, c, bucket, unobserved);
    } else if (part.type === "pseudo_element_selector") {
      unobserved.push(`::${part.name}`);
    }
  }
};

/**
 * What a selector depends on. `path` splits compounds (`>` / `+` / `~`
 * stay as their own entries). `compounds` lists, per compound, which
 * attrs can change its match and where the subjects sit (see
 * `CompoundDependency`). Flags say which observer channels the rule
 * needs. The native engine still matches; this only picks who to re-run
 * after a change.
 */
export function analyzeSelector(selector: string): SelectorAnalysis {
  const path: string[] = [];
  const compounds: CompoundDependency[] = [];
  const unobserved: string[] = [];
  let positional = false;
  for (const sel of parseSelectorList(selector).selectors) {
    const groups: { parts: SelectorPart[]; pathIndex: number }[] = [];
    const nextCombinator: (string | null)[] = [];
    let current: SelectorPart[] = [];
    const flush = () => {
      if (!current.length) return;
      groups.push({ parts: current, pathIndex: path.length });
      nextCombinator.push(null);
      path.push(
        selector.slice(current[0].start, current[current.length - 1].end)
      );
      current = [];
    };
    for (const part of sel.parts) {
      if (part.type === "combinator") {
        flush();
        if (groups.length) nextCombinator[groups.length - 1] = part.value;
        if (part.value !== " ") path.push(part.value);
        if (isSiblingCombinator(part)) positional = true;
      } else {
        current.push(part);
      }
    }
    flush();
    groups.forEach(({ parts, pathIndex }, k) => {
      const c = newCompound(
        pathIndex,
        path.slice(0, pathIndex + 1).join(" "),
        k === groups.length - 1
      );
      visitCompound(parts, c, "self", unobserved);
      const next = nextCombinator[k];
      c.root = next === "+" || next === "~" ? "parent" : "self";
      c.looseRoot = c.siblingInArgs ? "parent" : "self";
      if (c.positional || c.siblingInArgs) positional = true;
      compounds.push(c);
    });
  }
  const attrs = new Set<string>();
  let classNames: Set<string> | null = new Set<string>();
  compounds.forEach((c) => {
    [c.selfAttrs, c.looseAttrs, c.hasAttrs, c.broadAttrs].forEach((set) =>
      set.forEach((a) => attrs.add(a))
    );
    if (!c.classNames) classNames = null;
    else c.classNames.forEach((name) => classNames?.add(name));
  });
  const usesHas = compounds.some((c) => c.reactsToChildren);
  return {
    path,
    attrs,
    compounds,
    usesHas,
    positional,
    reactsToRemovals: usesHas || positional,
    unobserved,
    classNames,
  };
}

/** Analysis of the empty selector (a rule that targets the host itself). */
export const EMPTY_ANALYSIS: SelectorAnalysis = Object.freeze({
  path: [],
  attrs: new Set<string>(),
  compounds: [],
  usesHas: false,
  positional: false,
  reactsToRemovals: false,
  unobserved: [],
  classNames: new Set<string>(),
});

// example input: `div:not(.red) .my-section span`
// example output: { path: ["div:not(.red)", ".my-section", "span"], attrs: Set }
export function parseCssSelector(selector: string): {
  path: string[];
  attrs: Set<string>;
} {
  const { path, attrs } = analyzeSelector(selector);
  return { path, attrs };
}
