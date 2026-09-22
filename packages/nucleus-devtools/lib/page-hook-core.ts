import { auditDefinition } from "./audits";
import type { Heatmap } from "./heatmap";
import {
  type DefinitionRecord,
  type Diagnostic,
  EMPTY_INSPECT,
  HOOK_VERSION,
  MAX_DIAGNOSTICS,
  MAX_RECENT_RECORDS,
  MAX_RECORDS_PER_ELEMENT_PER_KIND,
  MESSAGE_SOURCE,
  type InspectSnapshot,
  type LifecycleRecord,
  type PageDevtoolsApi,
  type PageLog,
  type PageRenderer,
  type RendererKind,
} from "./protocol";

/**
 * MAIN-world probe logic, free of extension globals so it can be unit
 * tested. `page-hook.content.ts` installs it at `document_start`.
 *
 * Wire format: records are JSON-stringified before postMessage so the
 * isolated bridge / extension only ever sees plain data.
 */
export type PageHook = {
  version: typeof HOOK_VERSION;
  inject: (renderer: PageRenderer) => void;
  publicize: (path: readonly string[], meta?: Record<string, unknown>) => void;
};

export type PageHookOptions = {
  /** Deliver one JSON-stringified record to the isolated bridge. */
  post: (recordJson: string) => void;
  now?: () => number;
  /** Paint-count heatmap fed by `quark/apply` records (real paints only). */
  heatmap?: Heatmap;
  /** Sink for definition-audit warnings (default: the page console). */
  warn?: (message: string) => void;
};

const isPath = (path: readonly string[], ...expected: string[]) =>
  expected.length === path.length && expected.every((token, i) => token === path[i]);

const derefWeak = (value: unknown): Element | undefined => {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as WeakRef<Element>).deref === "function"
  ) {
    return (value as WeakRef<Element>).deref();
  }
  return undefined;
};

export const createPageHook = ({
  post,
  now = Date.now,
  heatmap,
  warn = (message) => console.warn(message),
}: PageHookOptions) => {
  const histories = new WeakMap<Element, LifecycleRecord[]>();
  const ids = new WeakMap<Element, string>();
  /* id → element, weakly: lets the agent tools turn a record back into a
   * selector. Dead refs are swept when the map grows past a threshold. */
  const refs = new Map<string, WeakRef<Element>>();
  const renderers = new Map<RendererKind, PageRenderer>();
  const recent: LifecycleRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map<string, DefinitionRecord>();
  let nextId = 1;
  let seq = 0;

  const sweepRefs = () => {
    if (refs.size < 4096) return;
    for (const [id, ref] of refs) if (!ref.deref()) refs.delete(id);
  };

  const getElementId = (el: Element | null | undefined): string | null => {
    if (!el) return null;
    const existing = ids.get(el);
    if (existing) return existing;
    const id = String(nextId++);
    ids.set(el, id);
    sweepRefs();
    refs.set(id, new WeakRef(el));
    return id;
  };

  const pushCapped = <T>(list: T[], item: T, cap: number) => {
    list.push(item);
    if (list.length > cap) list.splice(0, list.length - cap);
  };

  const asString = (value: unknown): string | null =>
    typeof value === "string" ? value : null;

  /** Errors and audits are kept page-wide for `diagnostics()`. */
  const noteDiagnostics = (
    record: LifecycleRecord,
    path: readonly string[],
    meta: Record<string, unknown>,
    audits: string[],
  ) => {
    const source = path[0] === "quark" || path[0] === "neutron" ? path[0] : null;
    if (source && path[1] === "error") {
      pushCapped(
        diagnostics,
        {
          seq: record.seq,
          at: record.at,
          level: "error",
          source,
          message: asString(meta.errorMessage) ?? "Unknown error",
          tag: record.tag,
          elementId: record.elementId,
          meta,
        },
        MAX_DIAGNOSTICS,
      );
    }
    for (const message of audits) {
      pushCapped(
        diagnostics,
        {
          seq: record.seq,
          at: record.at,
          level: "warning",
          source: "audit",
          message,
          tag: record.tag,
          elementId: null,
        },
        MAX_DIAGNOSTICS,
      );
    }
  };

  const noteDefinition = (record: LifecycleRecord, audits: string[]) => {
    const tag = record.tag;
    if (!tag) return;
    const props = Array.isArray(record.meta.props)
      ? (record.meta.props as Array<Record<string, unknown>>)
          .filter((p) => p && typeof p.prop === "string")
          .map((p) => ({ prop: p.prop as string, attr: asString(p.attr) }))
      : [];
    definitions.set(tag, { tag, at: record.at, props, audits });
  };

  const log: PageLog = {
    recent: () => [...recent],
    diagnostics: () => [...diagnostics],
    definitions: () => [...definitions.values()],
    elementById: (id) => (id ? (refs.get(id)?.deref() ?? null) : null),
  };

  const inspectWith = (kind: RendererKind, el: Element) => {
    const renderer = renderers.get(kind);
    if (!renderer) return null;
    try {
      return renderer.inspect(el) ?? null;
    } catch {
      return null;
    }
  };

  const api: PageDevtoolsApi = {
    getElementId,
    getLifecycles: (el) => (el ? (histories.get(el) ?? []) : []),
    inspect: (el): InspectSnapshot =>
      el
        ? { neutron: inspectWith("neutron", el), quark: inspectWith("quark", el) }
        : EMPTY_INSPECT,
  };

  /** Keep the newest `MAX` records of each producer kind per element. */
  const remember = (el: Element, record: LifecycleRecord) => {
    const kind = record.path[0];
    const list = [...(histories.get(el) ?? []), record];
    let excess =
      list.filter((r) => r.path[0] === kind).length -
      MAX_RECORDS_PER_ELEMENT_PER_KIND;
    histories.set(
      el,
      excess > 0
        ? list.filter((r) => !(r.path[0] === kind && excess-- > 0))
        : list,
    );
  };

  const hook: PageHook = {
    version: HOOK_VERSION,
    inject: (renderer) => {
      if (renderer?.kind) renderers.set(renderer.kind, renderer);
    },
    publicize: (path, meta = {}) => {
      const el = derefWeak(meta.weakElement);
      const elementId = getElementId(el ?? null);
      const { weakElement: _weak, ...safeMeta } = meta;
      const record: LifecycleRecord = {
        seq: ++seq,
        path: [...path],
        elementId,
        tag:
          typeof safeMeta.tag === "string"
            ? safeMeta.tag
            : (el?.localName ?? null),
        at: now(),
        meta: safeMeta,
      };
      /* Stringify in the page realm so the isolated bridge never sees
       * a cross-realm structured-clone surprise. */
      const recordJson = JSON.stringify(record);
      // Store JSON round-trip copies so history matches the wire format.
      const stored = JSON.parse(recordJson) as LifecycleRecord;
      if (el) remember(el, stored);
      pushCapped(recent, stored, MAX_RECENT_RECORDS);
      post(recordJson);
      /* Extension-side consumers of specific records. Never throw into
       * the producer: a broken audit or heatmap must not break the page. */
      try {
        let audits: string[] = [];
        if (isPath(path, "neutron", "defined")) {
          audits = auditDefinition(safeMeta);
          for (const message of audits) warn(message);
          noteDefinition(stored, audits);
        } else if (heatmap && el && isPath(path, "quark", "apply") && safeMeta.isNoop !== true) {
          heatmap.record(el);
        }
        noteDiagnostics(stored, path, stored.meta, audits);
      } catch {
        // ignore
      }
    },
  };

  const setHeatmapEnabled = (enabled: boolean) => heatmap?.setEnabled(enabled);

  return { api, hook, renderers, log, source: MESSAGE_SOURCE, setHeatmapEnabled };
};
