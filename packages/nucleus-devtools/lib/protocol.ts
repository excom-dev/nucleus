/** Must match `@excom/kit-devtools` `NUCLEUS_DEVTOOLS_HOOK_KEY`. */
export const HOOK_KEY = "__NUCLEUS_DEVTOOLS_HOOK__";

/** Page-side API for DevTools eval / selection queries. */
export const PAGE_API_KEY = "__NUCLEUS_DEVTOOLS__";

export const MESSAGE_SOURCE = "nucleus-devtools";
export const PORT_NAME = "nucleus-devtools";
export const HOOK_VERSION = 1 as const;

/**
 * Must match `@excom/kit-devtools` `NUCLEUS_DEVTOOLS_ATTACH_EVENT`:
 * dispatched on `globalThis` by a late-installed hook (the injectable
 * agent-tools bundle) so producers hand over their renderers.
 */
export const ATTACH_EVENT = "nucleus-devtools-attach";

/** History cap per element, per producer (`path[0]`: `neutron`, `quark`). */
export const MAX_RECORDS_PER_ELEMENT_PER_KIND = 200;
/** Page-wide caps for the agent tools' `trace` / `diagnostics` rings. */
export const MAX_RECENT_RECORDS = 500;
export const MAX_DIAGNOSTICS = 200;

export type PublicizePath = readonly string[];

/** Producer kinds that register a renderer with the hook. */
export type RendererKind = "neutron" | "quark";

/**
 * One publication, as stored in the page and sent over the wire. `seq` is a
 * page-wide monotonically increasing id: the dedupe / `iterate()` key.
 */
export type LifecycleRecord = {
  seq: number;
  path: string[];
  elementId: string | null;
  tag: string | null;
  at: number;
  meta: Record<string, unknown>;
};

/** Renderer handed to the hook by a producer (`hook.inject(renderer)`). */
export type PageRenderer = {
  version: number;
  kind: RendererKind;
  inspect: (el: Element) => Record<string, unknown> | null;
};

/** One `key: value` declaration of a Quark rule, as authored. */
export type QuarkDeclarationInfo = { key: string; value: string };

/** A Quark rule as the quark renderer reports it (no element references). */
export type QuarkRuleInfo = {
  sheetId: number;
  ruleId: number;
  selector: string;
  isScoped: boolean;
  numberOfRuns: number;
  declarations: QuarkDeclarationInfo[];
  listeners: Array<{ key: string; handlers: string; hasBlock: boolean }>;
};

/** A registered Quark sheet as the quark renderer reports it. */
export type QuarkSheetInfo = {
  sheetId: number;
  hash: string;
  host: Element | null;
  scopeId: string | null;
  isScoped: boolean;
  isRegistered: boolean;
  ruleCount: number;
  src: string;
  rules: QuarkRuleInfo[];
};

/**
 * Structural view of the quark renderer's agent-tooling surface (added in
 * `@excom/quark` alongside `inspect`). Every member is optional: an
 * older runtime injects a renderer without them and the tools degrade.
 */
export type QuarkRendererLike = PageRenderer & {
  sheets?: () => QuarkSheetInfo[];
  matchingRules?: (el: Element) => QuarkRuleInfo[];
  evaluate?: (el: Element, expression: string, sheetId?: number) => unknown;
};

/** An error or warning the page hook kept for the agent tools. */
export type Diagnostic = {
  seq: number;
  at: number;
  level: "error" | "warning";
  /** `quark` / `neutron` publications, or the extension's `audit`. */
  source: "quark" | "neutron" | "audit";
  message: string;
  tag: string | null;
  elementId: string | null;
  /** The publication's meta (errors) or nothing (audits). */
  meta?: Record<string, unknown>;
};

/** One `neutron/defined` publication plus the audit findings on it. */
export type DefinitionRecord = {
  tag: string;
  at: number;
  props: Array<{ prop: string; attr: string | null }>;
  audits: string[];
};

/** Page-wide state the hook keeps beyond per-element histories. */
export type PageLog = {
  recent: () => LifecycleRecord[];
  diagnostics: () => Diagnostic[];
  definitions: () => DefinitionRecord[];
  /** The live element behind a record's `elementId`, if still alive. */
  elementById: (id: string | null | undefined) => Element | null;
};

/** On-demand "current values" snapshot for the selected element. */
export type InspectSnapshot = {
  neutron: Record<string, unknown> | null;
  quark: Record<string, unknown> | null;
};

/** `browser.storage.session` key of the global heatmap toggle. */
export const HEATMAP_STORAGE_KEY = "heatmapEnabled";

export type BridgeMessage =
  | {
      source: typeof MESSAGE_SOURCE;
      type: "publicize";
      record: LifecycleRecord;
    }
  | {
      source: typeof MESSAGE_SOURCE;
      type: "ready";
    }
  /**
   * Heatmap toggle. Popup → background (stores it, fans out to every tab)
   * → bridge (ISOLATED) → `window.postMessage` → page hook (MAIN).
   */
  | {
      source: typeof MESSAGE_SOURCE;
      type: "heatmap";
      enabled: boolean;
    }
  /** Bridge → background on start; answered with `{ enabled }`. */
  | {
      source: typeof MESSAGE_SOURCE;
      type: "heatmap-state";
    };

export type HeatmapStateResponse = { enabled: boolean };

/** JSON-schema-shaped description of one agent tool (no `execute`). */
export type AgentToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type PageDevtoolsApi = {
  getElementId: (el: Element | null | undefined) => string | null;
  getLifecycles: (el: Element | null | undefined) => LifecycleRecord[];
  inspect: (el: Element | null | undefined) => InspectSnapshot;
  /**
   * Agent tools (`state_snapshot`, `inspect_element`, …), callable from any
   * browser-automation `evaluate` as
   * `__NUCLEUS_DEVTOOLS__.tools.<name>(input)`. Set by the installer.
   */
  tools?: Record<string, (input?: Record<string, unknown>) => unknown>;
  /** Descriptors of every tool in `tools`. */
  listTools?: () => AgentToolDescriptor[];
};

/** What `$0` looks like to the pane after an `inspectedWindow.eval`. */
export type SelectionInfo = {
  id: string | null;
  tag: string | null;
  lifecycles: LifecycleRecord[];
  inspect: InspectSnapshot;
};

export type SelectionState = "empty" | "unavailable" | "selected";

/** Provision published by `<devtools-selection>` (its `provision`). */
export type SelectionSnapshot = {
  state: SelectionState;
  tag: string | null;
  /** `$0` has an element id, i.e. at least one publication was ever seen. */
  hasPublications: boolean;
  records: LifecycleRecord[];
  inspect: InspectSnapshot;
};

export const EMPTY_INSPECT: InspectSnapshot = { neutron: null, quark: null };
