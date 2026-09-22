/**
 * Built-in `@use "quark:<name>"` modules: pure helpers grouped the way
 * Sass groups `sass:math` / `sass:list` / `sass:map` / `sass:string`.
 * Nothing here is global — a sheet imports what it needs
 * (`@use "quark:math" as math;` → `math.clamp(0, $x, 1)`; `as *` merges
 * the exports bare). Every function is pure, null-tolerant (a missing
 * collection reads as empty, a missing value passes through) and returns
 * copies, never mutating its arguments. Dashed names (`sort-by`) are
 * plain object keys: the evaluator calls own-property functions by name.
 *
 * Docs live in `language.ts` (`BUILTIN_MODULES`); a test keeps the
 * export lists in step.
 */
import type { Vars } from "./types";

type Path = string | null | undefined;

/** Dot-path read (`"user.name"`); `undefined` for a missing segment. */
const pathval = (obj: unknown, path: Path): unknown =>
  path == null || path === ""
    ? obj
    : String(path)
        .split(".")
        .reduce<unknown>(
          (acc, key) =>
            acc == null ? undefined : (acc as Record<string, unknown>)[key],
          obj
        );

/** Arrays as-is, objects as their values, everything else empty. */
const toList = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];

const toNumber = (value: unknown): number => {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

const isMap = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isEmptyValue = (value: unknown): boolean =>
  value == null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (isMap(value) && Object.keys(value).length === 0);

/** Loose equality, the way `find()` and `==` behave in expressions. */
const same = (a: unknown, b: unknown): boolean => a == b;

const math: Vars = {
  $pi: Math.PI,
  $e: Math.E,
  min: (...values: unknown[]) => Math.min(...values.flat().map(toNumber)),
  max: (...values: unknown[]) => Math.max(...values.flat().map(toNumber)),
  // CSS / Sass argument order: clamp(min, value, max)
  clamp: (min: unknown, value: unknown, max: unknown) =>
    Math.min(Math.max(toNumber(value), toNumber(min)), toNumber(max)),
  round: (value: unknown, digits: unknown = 0) => {
    const factor = 10 ** toNumber(digits);
    return Math.round(toNumber(value) * factor) / factor;
  },
  floor: (value: unknown) => Math.floor(toNumber(value)),
  ceil: (value: unknown) => Math.ceil(toNumber(value)),
  abs: (value: unknown) => Math.abs(toNumber(value)),
  // wrapping modulo: mod(-1, 3) === 2 (the `%` operator keeps the sign)
  mod: (value: unknown, divisor: unknown) => {
    const d = toNumber(divisor);
    if (d === 0) return NaN;
    return ((toNumber(value) % d) + d) % d;
  },
  pow: (base: unknown, exponent: unknown) =>
    toNumber(base) ** toNumber(exponent),
  sqrt: (value: unknown) => Math.sqrt(toNumber(value)),
  // percentage(0.25) → "25%"
  percentage: (fraction: unknown) => `${toNumber(fraction) * 100}%`,
};

const list: Vars = {
  count: (items: unknown, path?: Path, value?: unknown) => {
    const all = toList(items);
    if (path == null) return all.length;
    return all.filter((item) =>
      value === undefined
        ? !isEmptyValue(pathval(item, path))
        : same(pathval(item, path), value)
    ).length;
  },
  find: (items: unknown, path: Path, value: unknown) =>
    toList(items).find((item) => same(pathval(item, path), value)),
  filter: (items: unknown, path: Path, value?: unknown) =>
    toList(items).filter((item) =>
      value === undefined
        ? !isEmptyValue(pathval(item, path))
        : same(pathval(item, path), value)
    ),
  reject: (items: unknown, path: Path, value?: unknown) =>
    toList(items).filter((item) =>
      value === undefined
        ? isEmptyValue(pathval(item, path))
        : !same(pathval(item, path), value)
    ),
  pluck: (items: unknown, path: Path) =>
    toList(items).map((item) => pathval(item, path)),
  "sort-by": (items: unknown, path?: Path, direction: unknown = "asc") => {
    const desc = String(direction).toLowerCase() === "desc";
    const collator = new Intl.Collator(undefined, { numeric: true });
    return toList(items)
      .slice()
      .sort((a, b) => {
        const x = pathval(a, path);
        const y = pathval(b, path);
        const order =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : x == null || y == null
              ? (x == null ? 1 : 0) - (y == null ? 1 : 0)
              : collator.compare(String(x), String(y));
        return desc ? -order : order;
      });
  },
  sum: (items: unknown, path?: Path) =>
    toList(items).reduce<number>(
      (total, item) => total + toNumber(pathval(item, path)),
      0
    ),
  // range(3) → [0, 1, 2]; range(1, 4) → [1, 2, 3]; range(0, 10, 5) → [0, 5]
  range: (start: unknown, end?: unknown, step: unknown = 1) => {
    const from = end === undefined ? 0 : toNumber(start);
    const to = end === undefined ? toNumber(start) : toNumber(end);
    const by = Math.abs(toNumber(step)) || 1;
    const out: number[] = [];
    if (from <= to) for (let n = from; n < to; n += by) out.push(n);
    else for (let n = from; n > to; n -= by) out.push(n);
    return out;
  },
  unique: (items: unknown, path?: Path) => {
    const seen = new Set<unknown>();
    return toList(items).filter((item) => {
      const key = path == null ? item : pathval(item, path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  // group-by(list, "status") → { open: [...], done: [...] }
  "group-by": (items: unknown, path: Path) => {
    const groups: Record<string, unknown[]> = {};
    toList(items).forEach((item) => {
      const key = String(pathval(item, path) ?? "");
      (groups[key] ??= []).push(item);
    });
    return groups;
  },
  first: (items: unknown) => toList(items)[0],
  last: (items: unknown) => toList(items).at(-1),
  reverse: (items: unknown) => toList(items).slice().reverse(),
  // drops null / undefined / "" / [] / {}
  compact: (items: unknown) => toList(items).filter((v) => !isEmptyValue(v)),
};

const map: Vars = {
  get: (source: unknown, path: Path, fallback?: unknown) => {
    const value = pathval(source, path);
    return value === undefined ? fallback : value;
  },
  "has-key": (source: unknown, path: Path) =>
    pathval(source, path) !== undefined,
  keys: (source: unknown) => (isMap(source) ? Object.keys(source) : []),
  values: (source: unknown) => (isMap(source) ? Object.values(source) : []),
  // entries(map) → [(key: "a", value: 1), …] — iterate() rows with `item.key` / `item.value`
  entries: (source: unknown) =>
    isMap(source)
      ? Object.entries(source).map(([key, value]) => ({ key, value }))
      : [],
  merge: (...sources: unknown[]) => Object.assign({}, ...sources.filter(isMap)),
  pick: (source: unknown, ...keys: unknown[]) => {
    if (!isMap(source)) return {};
    const wanted = keys.flat().map(String);
    return Object.fromEntries(
      Object.entries(source).filter(([key]) => wanted.includes(key))
    );
  },
  omit: (source: unknown, ...keys: unknown[]) => {
    if (!isMap(source)) return {};
    const dropped = keys.flat().map(String);
    return Object.fromEntries(
      Object.entries(source).filter(([key]) => !dropped.includes(key))
    );
  },
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const string: Vars = {
  // plural(2, (one: "item", other: "items")) → "items"; Intl.PluralRules categories
  plural: (count: unknown, forms: unknown, locale?: unknown) => {
    if (!isMap(forms)) return "";
    const n = toNumber(count);
    const category = new Intl.PluralRules(
      typeof locale === "string" ? locale : undefined
    ).select(n);
    const form = forms[category] ?? forms.other ?? forms.one ?? "";
    return String(form).replace(/#/g, String(n));
  },
  "escape-html": (value: unknown) =>
    value == null
      ? ""
      : String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]),
  truncate: (value: unknown, max: unknown, suffix: unknown = "…") => {
    const text = value == null ? "" : String(value);
    const limit = Math.max(0, Math.floor(toNumber(max)));
    if (text.length <= limit) return text;
    const tail = String(suffix);
    return text.slice(0, Math.max(0, limit - tail.length)) + tail;
  },
  capitalize: (value: unknown) => {
    const text = value == null ? "" : String(value);
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  slugify: (value: unknown) =>
    (value == null ? "" : String(value))
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
};

const UNIT_MS: Record<string, number> = {
  second: 1000,
  seconds: 1000,
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (value == null || value === "") return null;
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const date: Vars = {
  // parse("2026-09-13") → Date, or null when unparseable
  parse: (value: unknown) => toDate(value),
  "is-valid": (value: unknown) => toDate(value) !== null,
  // format(value, "en-GB", (dateStyle: "medium")) → "13 Sept 2026"
  format: (value: unknown, locale?: unknown, options?: unknown) => {
    const parsed = toDate(value);
    if (!parsed) return "";
    return new Intl.DateTimeFormat(
      typeof locale === "string" ? locale : undefined,
      isMap(options) ? (options as Intl.DateTimeFormatOptions) : undefined
    ).format(parsed);
  },
  // add(value, 3, "days") → Date; months / years step the calendar
  add: (value: unknown, amount: unknown, unit: unknown = "days") => {
    const parsed = toDate(value);
    if (!parsed) return null;
    const n = toNumber(amount);
    const name = String(unit).toLowerCase();
    const next = new Date(parsed.getTime());
    if (name.startsWith("month")) next.setMonth(next.getMonth() + n);
    else if (name.startsWith("year")) next.setFullYear(next.getFullYear() + n);
    else next.setTime(next.getTime() + n * (UNIT_MS[name] ?? UNIT_MS.days));
    return next;
  },
  // diff(later, earlier, "days") → whole units between two dates
  diff: (a: unknown, b: unknown, unit: unknown = "days") => {
    const x = toDate(a);
    const y = toDate(b);
    if (!x || !y) return null;
    const name = String(unit).toLowerCase();
    if (name.startsWith("month") || name.startsWith("year")) {
      const months =
        (x.getFullYear() - y.getFullYear()) * 12 +
        (x.getMonth() - y.getMonth());
      return name.startsWith("year") ? Math.trunc(months / 12) : months;
    }
    return Math.trunc(
      (x.getTime() - y.getTime()) / (UNIT_MS[name] ?? UNIT_MS.days)
    );
  },
};

const url: Vars = {
  // query((q: "a b", page: 2, empty: none)) → "q=a+b&page=2"
  query: (params: unknown) => {
    const search = new URLSearchParams();
    if (isMap(params)) {
      Object.entries(params).forEach(([key, value]) => {
        if (value == null || value === "") return;
        if (Array.isArray(value)) {
          value.forEach((v) => v != null && search.append(key, String(v)));
        } else {
          search.set(key, String(value));
        }
      });
    }
    return search.toString();
  },
  // params("/search?q=a&page=2") → (q: "a", page: "2"); repeated keys become arrays
  params: (source: unknown) => {
    const text = source == null ? "" : String(source);
    const index = text.indexOf("?");
    const search = new URLSearchParams(
      index >= 0 ? text.slice(index + 1) : text.replace(/^#/, "")
    );
    const out: Record<string, string | string[]> = {};
    search.forEach((value, key) => {
      const existing = out[key];
      out[key] =
        existing === undefined
          ? value
          : Array.isArray(existing)
            ? [...existing, value]
            : [existing, value];
    });
    return out;
  },
  encode: (value: unknown) =>
    value == null ? "" : encodeURIComponent(String(value)),
};

const util: Vars = {
  // the first value that is not null / undefined (`or` also skips 0, "" and false)
  coalesce: (...values: unknown[]) => values.find((v) => v != null),
  "is-empty": (value: unknown) => isEmptyValue(value),
  "type-of": (value: unknown) =>
    value === null
      ? "null"
      : Array.isArray(value)
        ? "list"
        : value instanceof Date
          ? "date"
          : typeof value === "object"
            ? "map"
            : typeof value,
  "to-json": (value: unknown, indent?: unknown) =>
    value === undefined
      ? ""
      : JSON.stringify(
          value,
          null,
          indent == null ? undefined : toNumber(indent)
        ),
  "from-json": (text: unknown) => {
    if (typeof text !== "string") return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
};

/** `quark:` module name → its exports (documented in `language.ts` `BUILTIN_MODULES`). */
export const QUARK_MODULES: Readonly<Record<string, Vars>> = {
  math,
  list,
  map,
  string,
  date,
  url,
  util,
};

export const BUILTIN_MODULE_SCHEME = "quark:";

/** `"quark:math"` → `"math"`; `null` for other urls. */
export const builtinModuleName = (url: string): string | null =>
  url.startsWith(BUILTIN_MODULE_SCHEME)
    ? url.slice(BUILTIN_MODULE_SCHEME.length)
    : null;

/**
 * The exports of a `quark:` url, or `undefined` when the name is unknown
 * (`loadUseModules` logs and skips it like a failed import).
 */
export const resolveBuiltinModule = (url: string): Vars | undefined => {
  const name = builtinModuleName(url);
  return name === null ? undefined : QUARK_MODULES[name];
};
