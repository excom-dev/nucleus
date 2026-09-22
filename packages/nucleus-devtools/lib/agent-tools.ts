import type { Heatmap } from "./heatmap";
import {
  type AgentToolDescriptor,
  HOOK_VERSION,
  type LifecycleRecord,
  type PageDevtoolsApi,
  type PageLog,
  type PageRenderer,
  type QuarkRendererLike,
  type QuarkRuleInfo,
  type QuarkSheetInfo,
  type RendererKind,
} from "./protocol";

/**
 * Agent tools: what a coding agent needs to troubleshoot a Nucleus Stack
 * page, as selector-addressed, JSON-only functions.
 *
 * Two delivery paths share these definitions:
 * - `__NUCLEUS_DEVTOOLS__.tools.<name>(input)` for any browser
 *   automation with an `evaluate` (Playwright MCP, chrome-devtools-mcp
 *   `evaluate_script`, Cursor's browser).
 * - chrome-devtools-mcp's third-party developer tools
 *   (`devtoolstooldiscovery`, see `agent-discovery.ts`).
 *
 * Every element in a result is addressed by a unique CSS path (`selector`)
 * so the agent can pass it straight back. Nothing here writes to the page.
 */

export type AgentToolInput = Record<string, unknown>;

export type AgentToolDefinition = AgentToolDescriptor & {
  execute: (input: AgentToolInput) => unknown;
};

export type AgentToolsOptions = {
  api: PageDevtoolsApi;
  renderers: Map<RendererKind, PageRenderer>;
  log: PageLog;
  heatmap?: Heatmap;
  doc?: Document;
  now?: () => number;
};

export const AGENT_TOOL_GROUP = {
  name: "Nucleus Stack",
  description:
    "Runtime inspection of a Nucleus Stack (Neutron elements + Quark orchestration) page. " +
    "The DOM is the application State: state lives in attributes, rich data in each element's `provision` property, " +
    "Quark `$variables` on elements. Quark rules write attributes / content when their selector matches; " +
    "rules never revert when they stop matching (look for the inverse rule), later matching rules win (no specificity), " +
    "and setting attributes is recommended over toggling classes / ids (class / id changes re-run rules too, but cost Quark more). " +
    "Start with `diagnostics`, then `state_snapshot`, then " +
    "`explain_attribute` for the attribute that looks wrong.",
};

/* --------------------------------------------------------------- limits */

const LIMITS = {
  attrValue: 200,
  text: 160,
  string: 400,
  depth: 6,
  keys: 60,
  items: 60,
  snapshotDepth: 8,
  snapshotNodes: 500,
  history: 20,
  trace: 50,
  diagnostics: 50,
  heatmap: 20,
};

const SKIPPED_TAGS = new Set(["script", "style", "template", "noscript"]);
/** Elements whose text is source, not content (`list_sheets` has it). */
const SOURCE_TAGS = new Set(["quark-sheet"]);

/* -------------------------------------------------------------- helpers */

const escapeIdent = (value: string) =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/([^\w-])/g, "\\$1");

/**
 * A unique CSS path for `el`: the nearest unique `#id` ancestor (or the
 * root) then `tag:nth-of-type(n)` steps. Stable for the current document.
 */
export const cssPath = (el: Element, doc: Document = el.ownerDocument): string => {
  const steps: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.documentElement) {
    if (node.id && doc.querySelectorAll(`#${escapeIdent(node.id)}`).length === 1) {
      steps.unshift(`#${escapeIdent(node.id)}`);
      return steps.join(" > ");
    }
    const parent: Element | null = node.parentElement;
    let step = node.localName;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.localName === node!.localName);
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    steps.unshift(step);
    node = parent;
  }
  if (node === doc.documentElement) steps.unshift("html");
  return steps.join(" > ");
};

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}… [+${value.length - max}]` : value;

/** Depth / size-bounded copy of an already JSON-safe value. */
export const compact = (
  value: unknown,
  { depth = LIMITS.depth, string = LIMITS.string, keys = LIMITS.keys, items = LIMITS.items } = {},
): unknown => {
  if (typeof value === "string") return clip(value, string);
  if (value === null || typeof value !== "object") return value;
  if (depth <= 0) return Array.isArray(value) ? `[array ${value.length}]` : "[object]";
  const next = { depth: depth - 1, string, keys, items };
  if (Array.isArray(value)) {
    const out = value.slice(0, items).map((v) => compact(v, next));
    if (value.length > items) out.push(`… [+${value.length - items} more]`);
    return out;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries.slice(0, keys)) out[k] = compact(v, next);
  if (entries.length > keys) out["…"] = `+${entries.length - keys} more keys`;
  return out;
};

const pathString = (record: LifecycleRecord) => record.path.join("/");

/* -------------------------------------------------------------- schemas */

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const SELECTOR = str(
  "CSS selector of one element (the first match is used). Selectors returned by other tools can be passed back unchanged.",
);

/* ---------------------------------------------------------------- tools */

export const createAgentTools = ({
  api,
  renderers,
  log,
  heatmap,
  doc = document,
  now = Date.now,
}: AgentToolsOptions) => {
  const quark = () => renderers.get("quark") as QuarkRendererLike | undefined;
  const neutron = () => renderers.get("neutron");

  const requireString = (input: AgentToolInput, name: string): string => {
    const value = input[name];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`"${name}" must be a non-empty string`);
    }
    return value;
  };

  const optionalNumber = (input: AgentToolInput, name: string, fallback: number) =>
    typeof input[name] === "number" && Number.isFinite(input[name] as number)
      ? Math.max(0, Math.floor(input[name] as number))
      : fallback;

  const resolve = (input: AgentToolInput): { el: Element; selector: string } => {
    const selector = requireString(input, "selector");
    let el: Element | null;
    try {
      el = doc.querySelector(selector);
    } catch {
      throw new Error(`"${selector}" is not a valid CSS selector`);
    }
    if (!el) throw new Error(`No element matches "${selector}"`);
    return { el, selector };
  };

  const selectorOf = (el: Element | null | undefined) => (el ? cssPath(el, doc) : null);

  const selectorForRecord = (record: LifecycleRecord) =>
    selectorOf(log.elementById(record.elementId));

  const requireQuark = (member: keyof QuarkRendererLike) => {
    const renderer = quark();
    const fn = renderer?.[member];
    if (typeof fn !== "function") {
      throw new Error(
        renderer
          ? `The page's Quark runtime does not expose "${String(member)}" (update @excom/quark)`
          : "Quark has not registered with the DevTools hook on this page (no sheet has loaded yet, or the hook was installed after Quark)",
      );
    }
    return renderer as Required<QuarkRendererLike>;
  };

  const attributesOf = (el: Element) => {
    const out: Record<string, string> = {};
    for (const { name, value } of Array.from(el.attributes)) out[name] = clip(value, LIMITS.attrValue);
    return out;
  };

  const provisionOf = (el: Element): unknown => {
    const snapshot = neutron()?.inspect(el);
    const props = snapshot?.props as Record<string, unknown> | undefined;
    if (props && "provision" in props && props.provision != null) return props.provision;
    return undefined;
  };

  const varsOf = (el: Element): Record<string, unknown> | undefined => {
    const snapshot = quark()?.inspect(el);
    const vars = snapshot?.vars as Record<string, unknown> | undefined;
    return vars && Object.keys(vars).length ? vars : undefined;
  };

  const ownText = (el: Element) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();

  type SnapshotNode = {
    tag: string;
    selector: string;
    attributes: Record<string, string>;
    provision?: unknown;
    vars?: Record<string, unknown>;
    text?: string;
    children?: SnapshotNode[];
    /** Children not descended into (depth or node budget). */
    omittedChildren?: number;
  };

  const snapshot = (
    root: Element,
    { depth, includeText, budget }: { depth: number; includeText: boolean; budget: { left: number } },
  ): SnapshotNode => {
    budget.left--;
    const node: SnapshotNode = {
      tag: root.localName,
      selector: cssPath(root, doc),
      attributes: attributesOf(root),
    };
    const provision = provisionOf(root);
    if (provision !== undefined) node.provision = compact(provision);
    const vars = varsOf(root);
    if (vars) node.vars = compact(vars) as Record<string, unknown>;
    if (includeText && !SOURCE_TAGS.has(root.localName)) {
      const text = ownText(root);
      if (text) node.text = clip(text, LIMITS.text);
    }
    const children = Array.from(root.children).filter((c) => !SKIPPED_TAGS.has(c.localName));
    if (!children.length) return node;
    if (depth <= 0 || budget.left <= 0) {
      node.omittedChildren = children.length;
      return node;
    }
    node.children = [];
    for (const child of children) {
      if (budget.left <= 0) {
        node.omittedChildren = children.length - node.children.length;
        break;
      }
      node.children.push(snapshot(child, { depth: depth - 1, includeText, budget }));
    }
    return node;
  };

  const historyOf = (el: Element, limit: number) =>
    api
      .getLifecycles(el)
      .slice(-limit)
      .map((record) => ({
        seq: record.seq,
        at: record.at,
        path: pathString(record),
        meta: compact(record.meta),
      }));

  const sheetView = (
    sheet: QuarkSheetInfo,
    { includeSource, includeRules }: { includeSource: boolean; includeRules: boolean },
  ) => ({
    sheetId: sheet.sheetId,
    hash: sheet.hash,
    host: selectorOf(sheet.host),
    hostTag: sheet.host?.localName ?? null,
    scopeId: sheet.scopeId,
    isScoped: sheet.isScoped,
    isRegistered: sheet.isRegistered,
    ruleCount: sheet.ruleCount,
    srcLength: sheet.src.length,
    ...(includeSource ? { src: sheet.src } : {}),
    ...(includeRules ? { rules: sheet.rules } : {}),
  });

  /** Prop name a Neutron element reflects to attribute `attr`, if declared. */
  const propForAttr = (tag: string | null, attr: string) =>
    log
      .definitions()
      .find((d) => d.tag === tag)
      ?.props.find((p) => p.attr === attr)?.prop ?? null;

  /* ---- tool bodies */

  const stateSnapshot = (input: AgentToolInput) => {
    const selector = typeof input.selector === "string" && input.selector.trim() ? input.selector : "body";
    const { el } = resolve({ selector });
    const depth = optionalNumber(input, "depth", LIMITS.snapshotDepth);
    const maxNodes = optionalNumber(input, "maxNodes", LIMITS.snapshotNodes) || 1;
    const budget = { left: maxNodes };
    const tree = snapshot(el, { depth, includeText: input.includeText !== false, budget });
    return { at: now(), nodes: maxNodes - budget.left, truncated: budget.left <= 0, root: tree };
  };

  const inspectElement = (input: AgentToolInput) => {
    const { el } = resolve(input);
    const limit = optionalNumber(input, "historyLimit", LIMITS.history);
    const inspect = api.inspect(el);
    const q = quark();
    return {
      selector: cssPath(el, doc),
      tag: el.localName,
      elementId: api.getElementId(el),
      attributes: attributesOf(el),
      neutron: inspect.neutron ? compact(inspect.neutron) : null,
      quark: inspect.quark ? compact(inspect.quark) : null,
      matchingRules: typeof q?.matchingRules === "function" ? q.matchingRules(el) : null,
      history: historyOf(el, limit),
    };
  };

  const explainAttribute = (input: AgentToolInput) => {
    const { el } = resolve(input);
    const name = requireString(input, "name");
    const prop = propForAttr(el.localName, name);
    const writes = api
      .getLifecycles(el)
      .filter((record) => {
        const [producer, kind] = record.path;
        if (producer === "quark" && (kind === "apply" || kind === "error")) return record.meta.key === name;
        if (producer === "neutron" && kind === "effect" && prop) {
          const effect = record.meta.effect as Record<string, unknown> | undefined;
          return !!effect && prop in effect;
        }
        return false;
      })
      .slice(-LIMITS.history)
      .map((record) => ({
        seq: record.seq,
        at: record.at,
        by: pathString(record),
        ...(record.path[0] === "quark"
          ? {
              sheetId: record.meta.sheetId ?? null,
              ruleId: record.meta.ruleId ?? null,
              ruleSelector: record.meta.selector ?? null,
              expression: record.meta.expression ?? null,
              result: compact(record.meta.result),
              runId: record.meta.runId ?? null,
              isNoop: record.meta.isNoop === true,
              isWipe: record.meta.isWipe === true,
              ...(record.path[1] === "error" ? { error: record.meta.errorMessage ?? null } : {}),
            }
          : {
              signature: record.meta.signature ?? null,
              value: compact((record.meta.effect as Record<string, unknown>)[prop!]),
            }),
      }));
    const q = quark();
    const writesName = (rule: QuarkRuleInfo) => rule.declarations.some((d) => d.key === name);
    const matching = typeof q?.matchingRules === "function" ? q.matchingRules(el) : [];
    const matchingIds = new Set(matching.map((r) => `${r.sheetId}:${r.ruleId}`));
    const candidates =
      typeof q?.sheets === "function"
        ? q
            .sheets()
            .flatMap((s) => s.rules)
            .filter((r) => writesName(r) && !matchingIds.has(`${r.sheetId}:${r.ruleId}`))
            .map(({ sheetId, ruleId, selector }) => ({ sheetId, ruleId, selector }))
        : [];
    return {
      selector: cssPath(el, doc),
      tag: el.localName,
      name,
      current: el.getAttribute(name),
      reflectsProp: prop,
      writes,
      rulesMatchingNow: matching.filter(writesName),
      rulesNotMatching: candidates,
      note:
        writes.length === 0
          ? "No recorded write: the value is authored markup, app JS, or was set before the hook was installed."
          : "Quark rules do not revert: the last write stands until another rule (or JS) writes this attribute.",
    };
  };

  const listSheets = (input: AgentToolInput) =>
    requireQuark("sheets")
      .sheets()
      .map((sheet) =>
        sheetView(sheet, {
          includeSource: input.includeSource === true,
          includeRules: input.includeRules === true,
        }),
      );

  const matchingRules = (input: AgentToolInput) => {
    const { el } = resolve(input);
    return { selector: cssPath(el, doc), rules: requireQuark("matchingRules").matchingRules(el) };
  };

  const evaluateExpression = async (input: AgentToolInput) => {
    const { el } = resolve(input);
    const expression = requireString(input, "expression");
    const sheetId = typeof input.sheetId === "number" ? input.sheetId : undefined;
    const renderer = requireQuark("evaluate");
    let value: unknown;
    try {
      value = renderer.evaluate(el, expression, sheetId);
      if (value && typeof (value as PromiseLike<unknown>).then === "function") {
        value = await (value as PromiseLike<unknown>);
      }
    } catch (error) {
      throw new Error(`Quark could not evaluate "${expression}": ${(error as Error)?.message ?? String(error)}`);
    }
    return { selector: cssPath(el, doc), expression, value: compact(toJson(value)) };
  };

  const trace = (input: AgentToolInput) => {
    const limit = optionalNumber(input, "limit", LIMITS.trace);
    const prefix = typeof input.path === "string" ? input.path : null;
    const since = typeof input.sinceSeq === "number" ? input.sinceSeq : null;
    let target: Element | null = null;
    if (typeof input.selector === "string" && input.selector.trim()) target = resolve(input).el;
    const targetId = target ? api.getElementId(target) : null;
    const records = log
      .recent()
      .filter((r) => (since === null || r.seq > since) && (!prefix || pathString(r).startsWith(prefix)))
      .filter((r) => !targetId || r.elementId === targetId)
      .slice(-limit)
      .map((r) => ({
        seq: r.seq,
        at: r.at,
        path: pathString(r),
        tag: r.tag,
        selector: selectorForRecord(r),
        meta: compact(r.meta),
      }));
    return { count: records.length, lastSeq: log.recent().at(-1)?.seq ?? 0, records };
  };

  const diagnostics = (input: AgentToolInput) => {
    const limit = optionalNumber(input, "limit", LIMITS.diagnostics);
    const level = input.level === "error" || input.level === "warning" ? input.level : null;
    const all = log.diagnostics().filter((d) => !level || d.level === level);
    return {
      total: all.length,
      items: all.slice(-limit).map((d) => ({
        ...d,
        selector: selectorOf(log.elementById(d.elementId)),
        meta: d.meta ? compact(d.meta) : undefined,
      })),
    };
  };

  const listDefinitions = () => log.definitions();

  const heatmapTop = (input: AgentToolInput) => {
    if (!heatmap) return { items: [] };
    const n = optionalNumber(input, "n", LIMITS.heatmap);
    return {
      items: heatmap.top(n).map(({ element, count }) => ({
        selector: cssPath(element, doc),
        tag: element.localName,
        count,
      })),
    };
  };

  const dump = (input: AgentToolInput) => {
    const q = quark();
    return {
      tool: "nucleus-devtools",
      hookVersion: HOOK_VERSION,
      at: now(),
      url: doc.defaultView?.location?.href ?? null,
      title: doc.title,
      state: stateSnapshot({ selector: input.selector, depth: input.depth, maxNodes: input.maxNodes }),
      sheets:
        typeof q?.sheets === "function"
          ? q.sheets().map((s) => sheetView(s, { includeSource: true, includeRules: true }))
          : [],
      definitions: listDefinitions(),
      diagnostics: diagnostics({ limit: 100 }).items,
      trace: trace({ limit: 200 }).records,
      heatmap: heatmapTop({ n: 20 }).items,
      readme: AGENT_TOOL_GROUP.description,
    };
  };

  const definitions: AgentToolDefinition[] = [
    {
      name: "diagnostics",
      description:
        "Errors and warnings the page hook has seen: failed Quark expressions, Neutron effect errors, loop-guard trips (`LoopGuardDepth` / `LoopGuardBatch`), and element-definition audits. Check this first.",
      inputSchema: obj({
        limit: num("Newest N items (default 50)."),
        level: { type: "string", enum: ["error", "warning"], description: "Only this level." },
      }),
      execute: diagnostics,
    },
    {
      name: "state_snapshot",
      description:
        "Serialized application State: an element subtree with every attribute, each element's `provision` (rich data published by Neutron elements) and Quark `$variables`. Unlike an accessibility snapshot this shows the attributes rules select on. Scripts / styles / templates are skipped.",
      inputSchema: obj({
        selector: str('Root of the subtree (default "body").'),
        depth: num("Levels below the root (default 8)."),
        maxNodes: num("Node budget (default 500); `truncated` is true when hit."),
        includeText: bool("Include each element's own text (default true)."),
      }),
      execute: stateSnapshot,
    },
    {
      name: "inspect_element",
      description:
        "Everything known about one element: attributes, Neutron props + lifecycle flags, Quark `$variables` / attributes written / listeners, the Quark rules matching it right now, and its recent publication history (lifecycle effects, rule applications, errors).",
      inputSchema: obj({ selector: SELECTOR, historyLimit: num("Newest N history records (default 20).") }, [
        "selector",
      ]),
      execute: inspectElement,
    },
    {
      name: "explain_attribute",
      description:
        'Why an attribute has its value: every recorded write to it (Quark rule + expression + result, or Neutron effect), the rules that match the element now and declare it, and rules elsewhere that declare it but do not match. Answers "why is is-open still set?".',
      inputSchema: obj({ selector: SELECTOR, name: str("Attribute name, e.g. `is-open`.") }, ["selector", "name"]),
      execute: explainAttribute,
    },
    {
      name: "list_sheets",
      description:
        "Registered Quark sheets: host element, scope id, whether scoped to the host, rule count; optionally their source and rules (selector, declarations, `@on` listeners, run counts).",
      inputSchema: obj({
        includeSource: bool("Include each sheet's Quark source (default false)."),
        includeRules: bool("Include each sheet's rules (default false)."),
      }),
      execute: listSheets,
    },
    {
      name: "matching_rules",
      description:
        "Quark rules whose selector matches the element right now, in definition order across sheets (a later rule writing the same key wins). Includes each rule's declarations and listeners.",
      inputSchema: obj({ selector: SELECTOR }, ["selector"]),
      execute: matchingRules,
    },
    {
      name: "evaluate_expression",
      description:
        'Evaluate a Quark expression in an element\'s context, as a rule matching it would: `$bindings`, `attr("x")`, `prop("provision")`, built-ins, `@use` module functions of the sheet. Read-only by design; use it to test a hypothesis before editing a sheet.',
      inputSchema: obj(
        {
          selector: SELECTOR,
          expression: str('Quark expression, e.g. `$user.role == "admin"` or `prop("provision").items.length`.'),
          sheetId: num("Sheet whose `@use` modules to resolve (default: the first sheet with a rule matching the element)."),
        },
        ["selector", "expression"],
      ),
      execute: evaluateExpression,
    },
    {
      name: "trace",
      description:
        "Recent publications page-wide, oldest to newest: `neutron/constructed|connected|disconnected|effect|commit|error|defined`, `quark/sheet/registered|unregistered`, `quark/apply` (one per declaration; group by `runId`), `quark/error`. Filter by path prefix, element, or `sinceSeq` to poll for what happened after an action.",
      inputSchema: obj({
        limit: num("Newest N records (default 50, max 500 kept)."),
        path: str('Path prefix filter, e.g. "quark/apply" or "neutron".'),
        selector: str("Only records about this element."),
        sinceSeq: num("Only records with `seq` greater than this (use `lastSeq` from a previous call)."),
      }),
      execute: trace,
    },
    {
      name: "list_definitions",
      description:
        "Neutron element definitions seen on this page: tag, declared props with their reflected attribute names, and audit findings (non-dashed attributes, `data-` / `aria-` collisions, conflicting props).",
      inputSchema: obj({}),
      execute: listDefinitions,
    },
    {
      name: "heatmap_top",
      description:
        "Most-painted elements since page load (Quark rule applications that changed something), most first. Performance triage: a hot element usually means a rule fan-out or a write cycle.",
      inputSchema: obj({ n: num("How many (default 20).") }),
      execute: heatmapTop,
    },
    {
      name: "dump",
      description:
        "One JSON bug report: state snapshot, every sheet with source and rules, definitions, diagnostics, the last 200 publications and the paint heatmap. Large; prefer the focused tools while interacting live.",
      inputSchema: obj({
        selector: str('Snapshot root (default "body").'),
        depth: num("Snapshot depth (default 8)."),
        maxNodes: num("Snapshot node budget (default 500)."),
      }),
      execute: dump,
    },
  ];

  const tools: Record<string, (input?: AgentToolInput) => unknown> = {};
  for (const def of definitions) tools[def.name] = (input = {}) => def.execute(input ?? {});

  const listTools = (): AgentToolDescriptor[] =>
    definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

  return { definitions, tools, listTools };
};

/** Best-effort JSON-safe copy of an arbitrary in-page value. */
export const toJson = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (typeof value === "function") return { $constructor: "Function" };
  if (typeof value === "symbol") return { $constructor: "Symbol", description: value.description ?? null };
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Element) return { $element: value.localName, selector: cssPath(value) };
  if (value instanceof Node) return { $node: value.nodeName };
  const seen = new WeakSet<object>();
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v: unknown) => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "function") return { $constructor: "Function" };
        if (v instanceof Element) return { $element: v.localName, selector: cssPath(v) };
        if (v instanceof Node) return { $node: v.nodeName };
        if (v && typeof v === "object") {
          if (seen.has(v)) return { $constructor: "Circular" };
          seen.add(v);
          if (v instanceof Map) return { $constructor: "Map", entries: Array.from(v.entries()) };
          if (v instanceof Set) return { $constructor: "Set", values: Array.from(v.values()) };
          const proto = Object.getPrototypeOf(v);
          const name = (v as object).constructor?.name;
          if (proto !== Object.prototype && proto !== Array.prototype && proto !== null && name && name !== "Object") {
            // Dates and other toJSON-ers were already converted before the replacer saw them
            return { $constructor: name, ...Object.fromEntries(Object.entries(v)) };
          }
        }
        return v;
      }) ?? "null",
    );
  } catch {
    return { $unserializable: true };
  }
};

/** The installer's `api.tools` / `api.listTools` wiring, shared by both entry points. */
export const attachAgentTools = (api: PageDevtoolsApi, created: ReturnType<typeof createAgentTools>) => {
  api.tools = created.tools;
  api.listTools = created.listTools;
  return created;
};
