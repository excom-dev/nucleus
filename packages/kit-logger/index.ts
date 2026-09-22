const isNumber = (value: unknown): value is number =>
  typeof value === "number" && !Number.isNaN(value);

/** How deep the summarizer walks into plain objects / arrays. */
const SUMMARIZE_DEPTH = 6;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Swap DOM nodes for a short label so the console never serializes a
 * node tree (huge, circular, slow). Elements become `<tag>` / `<tag#id>`,
 * other nodes `[Node type=N]`. Walks plain objects and arrays (cycle-safe,
 * depth-limited). Class instances, errors, and primitives pass through.
 */
export const summarizeLogArg = (
  arg: unknown,
  depth = SUMMARIZE_DEPTH,
  seen: WeakSet<object> = new WeakSet()
): unknown => {
  if (typeof Node !== "undefined" && arg instanceof Node) {
    if (arg.nodeType === Node.ELEMENT_NODE) {
      const el = arg as Element;
      return el.id ? `<${el.localName}#${el.id}>` : `<${el.localName}>`;
    }
    return `[Node type=${arg.nodeType}]`;
  }
  if (depth <= 0 || typeof arg !== "object" || arg === null) return arg;
  if (Array.isArray(arg)) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    return arg.map((item) => summarizeLogArg(item, depth - 1, seen));
  }
  if (isPlainObject(arg)) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(arg)) {
      out[key] = summarizeLogArg(value, depth - 1, seen);
    }
    return out;
  }
  return arg;
};

/** Summarize every console argument (see `summarizeLogArg`). */
export const summarizeLogArgs = (args: any[]) =>
  args.map((arg) => summarizeLogArg(arg));

export type KitLogManagerOpts = {
  namespace: string;
  level?: number;
  /**
   * Reshape console args (`[prefix, ...args]`). DOM nodes are summarized
   * after this, so a custom formatter never has to.
   */
  formatArgs?: (args: any[]) => any[];
};
export class KitLogManager {
  namespace: string;
  level: number;
  #privateLevel?: number;
  formatArgs: (args: any[]) => any[];
  constructor(opts: KitLogManagerOpts) {
    this.namespace = opts.namespace;
    const LOG_LEVEL = parseInt((import.meta as any).env.VITE_LOG_LEVEL);
    this.level = (opts.level ?? isNumber(LOG_LEVEL)) ? LOG_LEVEL : 1;
    this.formatArgs = opts.formatArgs || ((args) => args);
  }
  #format(prefix: string, args: any[]) {
    return summarizeLogArgs(this.formatArgs([prefix, ...args]));
  }
  info(...args) {
    if (this.level >= 4)
      console.log(...this.#format(`${this.namespace} info: `, args));
  }
  debug(...args) {
    if (this.level >= 3)
      console.log(...this.#format(`${this.namespace} debug: `, args));
  }
  warn(...args) {
    if (this.level >= 2)
      console.warn(...this.#format(`${this.namespace} warn: `, args));
  }
  error(...args) {
    if (this.level >= 1)
      console.error(...this.#format(`${this.namespace} error: `, args));
  }
  suppress() {
    if (this.#privateLevel !== undefined) return;
    this.#privateLevel = this.level;
    this.level = 0;
  }
  unsuppress() {
    if (this.#privateLevel === undefined) return;
    this.level = this.#privateLevel as number;
    this.#privateLevel = undefined;
  }
}
export const KitLogger = new KitLogManager({ namespace: "KitLogger" });
