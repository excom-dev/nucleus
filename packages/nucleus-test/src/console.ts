const METHODS = ["log", "info", "debug", "warn", "error"] as const;
const GUARDED = Symbol.for("@excom/nucleus-test/console-guard");
// global: `setup` and the index are separate bundles
const SINKS = Symbol.for("@excom/nucleus-test/console-sinks");

type Sinks = Record<(typeof METHODS)[number], (...args: unknown[]) => void>;

/**
 * `arg` with DOM nodes summarized as `<tag>`, `<tag#id>` or `[Node type=N]`,
 * inside plain objects and arrays too, `depth` levels deep. Cycle-safe.
 */
export const summarizeConsoleArg = (
  arg: unknown,
  depth = 6,
  seen: WeakSet<object> = new WeakSet()
): unknown => {
  if (arg instanceof Node) {
    if (arg.nodeType !== Node.ELEMENT_NODE)
      return `[Node type=${arg.nodeType}]`;
    const { localName, id } = arg as Element;
    return id ? `<${localName}#${id}>` : `<${localName}>`;
  }
  if (depth <= 0 || typeof arg !== "object" || arg === null) return arg;
  const proto = Object.getPrototypeOf(arg);
  if (!Array.isArray(arg) && proto !== Object.prototype && proto !== null)
    return arg;
  if (seen.has(arg)) return "[Circular]";
  seen.add(arg);
  const summarize = (value: unknown) =>
    summarizeConsoleArg(value, depth - 1, seen);
  return Array.isArray(arg)
    ? arg.map(summarize)
    : Object.fromEntries(
        Object.entries(arg).map(([key, value]) => [key, summarize(value)])
      );
};

/** The real console methods the guard forwards to: swap one to capture / silence output. */
export const consoleSinks: Sinks = ((globalThis as { [SINKS]?: Sinks })[
  SINKS
] ??= {} as Sinks);

/**
 * Console methods print DOM nodes summarized: happy-dom inspects a node to
 * thousands of lines. Safe to repeat.
 */
export function guardConsole(): void {
  for (const method of METHODS.filter(
    (method) => !(GUARDED in console[method])
  )) {
    consoleSinks[method] = console[method];
    console[method] = Object.assign(
      (...args: unknown[]) =>
        consoleSinks[method].apply(
          console,
          args.map((arg) => summarizeConsoleArg(arg))
        ),
      { [GUARDED]: true }
    );
  }
}
