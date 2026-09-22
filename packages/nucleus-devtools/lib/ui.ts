import type {
  InspectSnapshot,
  LifecycleRecord,
  SelectionState,
} from "./protocol";

/**
 * Pure helpers the pane's Quark sheet `@use`s as `/devtools-ui`.
 *
 * Everything here is a function of its arguments: the sheet decides *where*
 * output goes, these decide *what* it looks like. The JSON tree renderer
 * returns DOM nodes (a module function may return a `Node`), which keeps
 * recursive rendering out of Quark rules.
 */

const MAX_STRING = 20;
const MAX_PREVIEW_ITEMS = 3;
const MAX_PREVIEW_DEPTH = 2;

export const formatTime = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

const truncateString = (value: string) =>
  value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

type ValueDesc =
  | { kind: "null" | "undefined" | "empty-array" | "empty-object" | "function" }
  | { kind: "string" | "number" | "boolean" | "unknown" | "node"; text: string }
  | { kind: "constructor"; name: string }
  | { kind: "array"; items: unknown[] }
  | { kind: "object"; entries: [string, unknown][] };

export const describeValue = (value: unknown): ValueDesc => {
  if (value === null) return { kind: "null" };
  if (value === undefined) return { kind: "undefined" };
  const t = typeof value;
  if (t === "string") {
    return {
      kind: "string",
      text: JSON.stringify(truncateString(value as string)),
    };
  }
  if (t === "number" || t === "boolean") {
    return { kind: t, text: String(value) };
  }
  if (t === "function") return { kind: "function" };
  if (Array.isArray(value)) {
    return value.length
      ? { kind: "array", items: value }
      : { kind: "empty-array" };
  }
  if (isPlainObject(value)) {
    if (typeof value.$constructor === "string" && !("$element" in value)) {
      return { kind: "constructor", name: value.$constructor };
    }
    if (typeof value.$element === "string") {
      return {
        kind: "node",
        text: `<${value.$element}${value.id ? `#${value.id}` : ""}>`,
      };
    }
    if (typeof value.$node === "string") {
      return { kind: "node", text: `<${value.$node}>` };
    }
    const keys = Object.keys(value);
    return keys.length
      ? { kind: "object", entries: keys.map((key) => [key, value[key]]) }
      : { kind: "empty-object" };
  }
  return { kind: "unknown", text: truncateString(String(value)) };
};

const leafText = (desc: ValueDesc): string | null => {
  switch (desc.kind) {
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "function":
      return "Function";
    case "empty-array":
      return "[]";
    case "empty-object":
      return "{}";
    case "string":
    case "number":
    case "boolean":
    case "unknown":
    case "node":
      return desc.text;
    case "constructor":
      return desc.name;
    default:
      return null;
  }
};

const leafKind = (desc: ValueDesc): string => {
  switch (desc.kind) {
    case "empty-array":
      return "array";
    case "empty-object":
      return "object";
    case "function":
      return "constructor";
    default:
      return desc.kind;
  }
};

const span = (role: string, text: string, attr: "kind" | "role" = "kind") => {
  const el = document.createElement("span");
  el.dataset[attr] = role;
  el.textContent = text;
  return el;
};

/** Compact one-line preview used in collapsed `<summary>` labels. */
export const previewValue = (value: unknown, depth = 0): string => {
  const desc = describeValue(value);
  const leaf = leafText(desc);
  if (leaf != null) return leaf;

  if (desc.kind === "array") {
    if (depth >= MAX_PREVIEW_DEPTH) {
      return desc.items.length ? `[${desc.items.length}]` : "[]";
    }
    const shown = desc.items
      .slice(0, MAX_PREVIEW_ITEMS)
      .map((item) => previewValue(item, depth + 1));
    const more = desc.items.length > MAX_PREVIEW_ITEMS ? ", …" : "";
    return `[${shown.join(", ")}${more}]`;
  }

  if (desc.kind === "object") {
    if (depth >= MAX_PREVIEW_DEPTH) {
      return desc.entries.length ? `{…${desc.entries.length}}` : "{}";
    }
    const shown = desc.entries
      .slice(0, MAX_PREVIEW_ITEMS)
      .map(([key, val]) => `${key}: ${previewValue(val, depth + 1)}`);
    const more = desc.entries.length > MAX_PREVIEW_ITEMS ? ", …" : "";
    return `{ ${shown.join(", ")}${more} }`;
  }

  return "…";
};

const childEntries = (desc: ValueDesc): [string, unknown][] =>
  desc.kind === "array"
    ? desc.items.map((item, i): [string, unknown] => [String(i), item])
    : desc.kind === "object"
      ? desc.entries
      : [];

/** Optional hover text per top-level key (Quark: the declaration source). */
export type EntryTitles = Record<string, string> | null | undefined;

/**
 * Hover text for a leaf: tagged functions carry the Quark declaration that
 * produced them (`{ $constructor: "Function", $expression: "fn($x)" }`).
 */
const leafTitle = (value: unknown): string | undefined =>
  isPlainObject(value) && typeof value.$expression === "string"
    ? value.$expression
    : undefined;

const leafSpan = (value: unknown, desc: ValueDesc, text: string) => {
  const el = span(leafKind(desc), text);
  const title = leafTitle(value);
  if (title) el.title = title;
  return el;
};

/**
 * One `key: value` line. Leaves are a flat row; objects / arrays are a
 * `<details>` whose `<summary>` carries the caret, key and one-line preview
 * on a single non-wrapping line, with the children indented below it.
 */
const renderEntry = (key: string, value: unknown, title?: string): HTMLElement => {
  const desc = describeValue(value);
  const leaf = leafText(desc);
  const keyEl = span("key", key, "role");
  if (title) keyEl.title = title;
  if (leaf != null) {
    const row = document.createElement("div");
    row.dataset.role = "entry";
    row.append(keyEl, leafSpan(value, desc, leaf));
    return row;
  }
  const details = document.createElement("details");
  details.dataset.role = "entry";
  details.dataset.kind = desc.kind;
  const summary = document.createElement("summary");
  summary.append(keyEl, span("preview", previewValue(value), "role"));
  details.append(summary, renderEntries(childEntries(desc)));
  return details;
};

const renderEntries = (entries: [string, unknown][], titles?: EntryTitles): HTMLElement => {
  const list = document.createElement("div");
  list.dataset.role = "entries";
  for (const [key, val] of entries) {
    list.append(renderEntry(key, val, titles?.[key]));
  }
  return list;
};

/** Render a JSON value as a tree (objects / arrays collapsed by default). */
export const renderValue = (
  value: unknown,
  {
    open = false,
    bare = false,
    titles,
  }: { open?: boolean; bare?: boolean; titles?: EntryTitles } = {},
): Node => {
  const desc = describeValue(value);
  const leaf = leafText(desc);
  if (leaf != null) return leafSpan(value, desc, leaf);

  if (desc.kind === "array" || desc.kind === "object") {
    const entries = renderEntries(childEntries(desc), titles);
    if (bare) {
      const root = document.createElement("div");
      root.dataset.kind = desc.kind;
      root.dataset.role = "tree-root";
      root.append(entries);
      return root;
    }
    const details = document.createElement("details");
    details.open = open;
    details.dataset.kind = desc.kind;
    const summary = document.createElement("summary");
    summary.append(span("preview", previewValue(value), "role"));
    details.append(summary, entries);
    return details;
  }

  return span("unknown", "…");
};

/**
 * Sheet entry point: a bare (no outer `<details>`) tree for a record body or
 * a "current" block. `titles` puts hover text on top-level keys.
 */
export const renderTree = (value: unknown, titles?: EntryTitles): Node =>
  renderValue(value ?? {}, { bare: true, titles });

/* --- Selection header --- */

export const selectionLabel = (
  state: SelectionState | string | null,
  tag: string | null,
  hasPublications: boolean | string | null,
): string => {
  if (state === "unavailable") return "Page API unavailable — reload the tab";
  if (state !== "selected" || !tag) return "Select an element";
  // attribute-reflected booleans arrive as "" (present) / null (absent)
  const published = hasPublications === true || hasPublications === "";
  return published ? `<${tag}>` : `<${tag}> — no publications yet`;
};

export const isEmptyLabel = (state: SelectionState | string | null): boolean =>
  state !== "selected";

/** "Copy for AI" button label; `did-copy` arrives as `""` (set) / null. */
export const copyLabel = (didCopy: boolean | string | null): string =>
  didCopy === true || didCopy === "" ? "Copied" : "Copy for AI";

/* --- Log rows --- */

export type LogRow = {
  key: number;
  signature: string;
  time: string;
  /** Rendered as the row body tree. */
  effect: Record<string, unknown>;
  /** Hover text per effect key (Quark: `key: expression`). */
  titles: Record<string, string>;
  /** Indent level: Neutron lock depth − 1. Always 0 for Quark. */
  depth: number;
  /** `""` | `no-op` | `wipe` | `error`. */
  status: string;
};

const isPath = (record: LifecycleRecord, ...tokens: string[]) =>
  tokens.every((token, i) => record.path[i] === token);

const asNumber = (value: unknown, fallback: number) =>
  typeof value === "number" ? value : fallback;

const asString = (value: unknown, fallback: string) =>
  typeof value === "string" && value ? value : fallback;

/** Neutron `effect` publications → rows, same shape the old pane rendered. */
export const neutronEffects = (
  records: LifecycleRecord[] | null | undefined,
): LogRow[] =>
  (records ?? []).filter((r) => isPath(r, "neutron", "effect")).map((r) => ({
    key: r.seq,
    signature: asString(r.meta.signature, "(anonymous effector)"),
    time: formatTime(r.at),
    effect: isPlainObject(r.meta.effect) ? r.meta.effect : {},
    titles: {},
    depth: Math.max(asNumber(r.meta.lockDepth, 1) - 1, 0),
    status: "",
  }));

const applyStatus = (meta: Record<string, unknown>) =>
  meta.isNoop ? "no-op" : meta.isWipe ? "wipe" : "";

const isFunctionRef = (value: unknown) =>
  isPlainObject(value) && value.$constructor === "Function";

/** Listener results are function refs; tag them with their declaration. */
const applyResult = (meta: Record<string, unknown>) => {
  if (meta.isNoop) return "(no-op)";
  const { result } = meta;
  if (meta.kind !== "listener") return result;
  const expression = asString(meta.expression, "");
  const tag = (fn: unknown) =>
    isFunctionRef(fn) ? { ...(fn as object), $expression: expression } : fn;
  return Array.isArray(result) ? result.map(tag) : tag(result);
};

/**
 * Quark `apply` / `error` publications → rows mirroring the Neutron log.
 * Applies from one rule run on one element (same sheet, rule, run id,
 * element) collapse into one row, a rule applying several declarations,
 * like a lifecycle applying several props. Grouping is order-independent:
 * a `content` that settles later (template / iterate promises) still lands
 * in its rule's row. Errors stay separate rows.
 */
export const quarkApplies = (
  records: LifecycleRecord[] | null | undefined,
): LogRow[] => {
  const rows: LogRow[] = [];
  const groups = new Map<string, { row: LogRow; statuses: string[] }>();
  for (const r of records ?? []) {
    const key = asString(r.meta.key, "?");
    const declaration = `${key}: ${asString(r.meta.expression, "")}`;
    if (isPath(r, "quark", "error")) {
      rows.push({
        key: r.seq,
        signature: asString(r.meta.selector, "(no selector)"),
        time: formatTime(r.at),
        effect: {
          [key]: {
            error: asString(r.meta.errorName, "Error"),
            message: r.meta.errorMessage,
          },
        },
        titles: { [key]: declaration },
        depth: 0,
        status: "error",
      });
      continue;
    }
    if (!isPath(r, "quark", "apply")) continue;
    const id = [r.meta.sheetId, r.meta.ruleId, r.meta.runId, r.elementId].join("|");
    const group = groups.get(id);
    if (group && !(key in group.row.effect)) {
      group.row.effect[key] = applyResult(r.meta);
      group.row.titles[key] = declaration;
      group.statuses.push(applyStatus(r.meta));
      continue;
    }
    const row: LogRow = {
      key: r.seq,
      signature: asString(r.meta.selector, "(no selector)"),
      time: formatTime(r.at),
      effect: { [key]: applyResult(r.meta) },
      titles: { [key]: declaration },
      depth: 0,
      status: "",
    };
    rows.push(row);
    groups.set(id, { row, statuses: [applyStatus(r.meta)] });
  }
  for (const { row, statuses } of groups.values()) {
    row.status = statuses.every((s) => s === statuses[0]) ? statuses[0] : "";
  }
  return rows;
};

export const hasRows = (rows: LogRow[] | null | undefined): boolean =>
  !!rows && rows.length > 0;

/* --- Current values --- */

/** Neutron "current" block: the element's prop values, or `null`. */
export const neutronCurrent = (
  inspect: InspectSnapshot | null | undefined,
): Record<string, unknown> | null => {
  const snap = inspect?.neutron;
  if (!snap) return null;
  return (snap.props as Record<string, unknown>) ?? {};
};

/**
 * Quark "current" block: variables, Quark-written
 * attributes / CSS custom properties, listeners (tagged functions with
 * their declaration as hover text), loop context.
 * Empty sections are omitted; `null` when there is nothing to show.
 */
export const quarkCurrent = (
  inspect: InspectSnapshot | null | undefined,
): Record<string, unknown> | null => {
  const snap = inspect?.quark as
    | {
        vars?: Record<string, unknown>;
        attributes?: Record<string, unknown>;
        styleProperties?: Record<string, unknown>;
        listeners?: Record<string, unknown>;
        loop?: { index: unknown; key: unknown } | null;
      }
    | null
    | undefined;
  if (!snap) return null;
  const variables = { ...(snap.vars ?? {}) };
  const sections: Record<string, unknown> = {};
  const add = (label: string, value: Record<string, unknown> | null | undefined) => {
    if (value && Object.keys(value).length) sections[label] = value;
  };
  add("variables", variables);
  add("attributes", snap.attributes);
  add("style properties", snap.styleProperties);
  add("listeners", snap.listeners);
  if (snap.loop) sections.loop = snap.loop;
  return Object.keys(sections).length ? sections : null;
};
