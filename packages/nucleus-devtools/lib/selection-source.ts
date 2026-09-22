import type { DevtoolsAdapter } from "./devtools-adapter";
import {
  EMPTY_INSPECT,
  MESSAGE_SOURCE,
  PAGE_API_KEY,
  PORT_NAME,
  type LifecycleRecord,
  type SelectionInfo,
  type SelectionSnapshot,
} from "./protocol";

export type SelectionSourceOptions = {
  /** Debounce before re-reading `$0` history from the page. */
  refreshDelay?: number;
  /** Keepalive ping period for the background port. */
  pingInterval?: number;
  /** Delay before reconnecting a dropped port. */
  reconnectDelay?: number;
  /** Cap on remembered record ids (dedupe across channels). */
  maxSeen?: number;
};

const DEFAULTS: Required<SelectionSourceOptions> = {
  refreshDelay: 32,
  pingInterval: 20000,
  reconnectDelay: 100,
  maxSeen: 500,
};

/** `$0` → `{ id, tag, lifecycles, inspect }` via the page API. */
export const SELECTION_EXPRESSION = `(function () {
  const api = globalThis[${JSON.stringify(PAGE_API_KEY)}];
  const el = $0;
  if (!api || !el) return { id: null, tag: null, lifecycles: [], inspect: { neutron: null, quark: null } };
  return {
    id: api.getElementId(el),
    tag: el.localName || null,
    lifecycles: api.getLifecycles(el),
    inspect: api.inspect(el),
  };
})()`;

/**
 * `tools.dump()` on the page → JSON string, or `null` when the page API or
 * the agent tools are missing (older probe / page never hooked).
 */
export const DUMP_EXPRESSION = `(function () {
  const api = globalThis[${JSON.stringify(PAGE_API_KEY)}];
  const dump = api && api.tools && api.tools.dump;
  if (typeof dump !== "function") return null;
  return JSON.stringify(dump({}), null, 2);
})()`;

/**
 * Tracks the Elements-panel selection and its publication history.
 *
 * Live updates need a channel that survives MV3 service-worker sleep:
 * - runtime.onMessage (direct from content script when Chrome delivers it)
 * - reconnecting port through background (fallback + keepalive)
 *
 * Emits a `SelectionSnapshot` whenever the view should change. The
 * `<devtools-selection>` Adapter turns snapshots into attributes + `provision`.
 */
export class SelectionSource {
  private options: Required<SelectionSourceOptions>;
  private selectedElementId: string | null = null;
  private records: LifecycleRecord[] = [];
  private snapshot: SelectionSnapshot = {
    state: "empty",
    tag: null,
    hasPublications: false,
    records: [],
    inspect: EMPTY_INSPECT,
  };
  private seen = new Set<number>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private disposers: Array<() => void> = [];
  private isStarted = false;

  constructor(
    private adapter: DevtoolsAdapter,
    private emit: (snapshot: SelectionSnapshot) => void,
    options: SelectionSourceOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  get current(): SelectionSnapshot {
    return this.snapshot;
  }

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
    this.disposers.push(
      this.adapter.onRuntimeMessage((message) => this.onBridgeMessage(message)),
    );
    this.connectPort();
    this.disposers.push(
      this.adapter.onSelectionChanged(() => {
        this.seen.clear();
        void this.refresh();
      }),
    );
    void this.refresh();
  }

  stop(): void {
    if (!this.isStarted) return;
    this.isStarted = false;
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
  }

  /** Re-read `$0` history from the page, the authoritative path. */
  async refresh(): Promise<void> {
    const info = await this.adapter.evalInPage<SelectionInfo>(
      SELECTION_EXPRESSION,
    );
    if (!this.isStarted) return;

    if (!info) {
      this.selectedElementId = null;
      this.records = [];
      this.publish({
        state: "unavailable",
        tag: null,
        hasPublications: false,
        inspect: EMPTY_INSPECT,
      });
      return;
    }

    this.selectedElementId = info.id;
    this.records = info.lifecycles ?? [];
    this.publish({
      state: info.tag ? "selected" : "empty",
      tag: info.tag,
      hasPublications: !!info.id,
      inspect: info.inspect ?? EMPTY_INSPECT,
    });
  }

  /** The page's agent-tools bug report as pretty JSON (see `DUMP_EXPRESSION`). */
  dump(): Promise<string | null> {
    return this.adapter.evalInPage<string>(DUMP_EXPRESSION);
  }

  private publish(partial: Omit<SelectionSnapshot, "records">) {
    this.snapshot = { ...partial, records: [...this.records] };
    this.emit(this.snapshot);
  }

  private scheduleRefresh() {
    if (!this.selectedElementId) return;
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, this.options.refreshDelay);
  }

  private remember(seq: number): boolean {
    if (this.seen.has(seq)) return false;
    this.seen.add(seq);
    if (this.seen.size > this.options.maxSeen) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
    return true;
  }

  private onBridgeMessage(message: unknown) {
    if (!message || typeof message !== "object") return;
    const msg = message as Record<string, unknown>;
    if (msg.source !== MESSAGE_SOURCE) return;
    if (msg.type !== "publicize") return;
    if (!this.selectedElementId) return;

    // Prefer appending when the payload is well-formed and matches $0.
    const record = msg.record as LifecycleRecord | undefined;
    if (
      record?.elementId &&
      record.elementId === this.selectedElementId &&
      typeof record.seq === "number" &&
      this.remember(record.seq)
    ) {
      this.records = [...this.records, record];
      this.publish({ ...this.snapshot });
      // "current" values changed too: resync from the page
      this.scheduleRefresh();
      return;
    }

    // Missing/mismatched elementId (or duplicate channel delivery): sync from page.
    this.scheduleRefresh();
  }

  private connectPort() {
    if (!this.isStarted) return;
    const port = this.adapter.connectPort(PORT_NAME);
    port.onMessage((message) => this.onBridgeMessage(message));

    // Ping keeps the MV3 background service worker alive while the pane is open.
    const ping = setInterval(() => {
      try {
        port.postMessage({ source: MESSAGE_SOURCE, type: "ready" });
      } catch {
        clearInterval(ping);
      }
    }, this.options.pingInterval);
    this.disposers.push(() => clearInterval(ping));

    port.onDisconnect(() => {
      clearInterval(ping);
      const timer = setTimeout(() => this.connectPort(), this.options.reconnectDelay);
      this.disposers.push(() => clearTimeout(timer));
    });
  }
}
