import type { DevtoolsAdapter, DevtoolsPort } from "../../lib/devtools-adapter";
import type { LifecycleRecord, SelectionInfo } from "../../lib/protocol";
import { MESSAGE_SOURCE } from "../../lib/protocol";

/**
 * Scriptable stand-in for the extension API. Tests set `info` (what `$0`
 * evaluates to), then drive the pane through `selectElement()`,
 * `deliverRuntime()` / `deliverPort()` and `dropPort()`.
 */
export const createFakeAdapter = () => {
  let info: SelectionInfo | null = null;
  const runtimeListeners = new Set<(message: unknown) => void>();
  const selectionListeners = new Set<() => void>();
  const ports: Array<{
    port: DevtoolsPort;
    messageCbs: Array<(message: unknown) => void>;
    disconnectCbs: Array<() => void>;
    posted: unknown[];
  }> = [];
  let evalCount = 0;

  const adapter: DevtoolsAdapter = {
    evalInPage: async <T>() => {
      evalCount++;
      return info as T | null;
    },
    onRuntimeMessage: (cb) => {
      runtimeListeners.add(cb);
      return () => runtimeListeners.delete(cb);
    },
    onSelectionChanged: (cb) => {
      selectionListeners.add(cb);
      return () => selectionListeners.delete(cb);
    },
    connectPort: () => {
      const entry = {
        messageCbs: [] as Array<(message: unknown) => void>,
        disconnectCbs: [] as Array<() => void>,
        posted: [] as unknown[],
        port: null as unknown as DevtoolsPort,
      };
      entry.port = {
        postMessage: (message) => entry.posted.push(message),
        onMessage: (cb) => entry.messageCbs.push(cb),
        onDisconnect: (cb) => entry.disconnectCbs.push(cb),
      };
      ports.push(entry);
      return entry.port;
    },
  };

  const publicize = (record: LifecycleRecord) => ({
    source: MESSAGE_SOURCE,
    type: "publicize",
    record,
  });

  return {
    adapter,
    ports,
    get evalCount() {
      return evalCount;
    },
    /** What the next `$0` eval resolves to (`null` = page API unavailable). */
    setInfo: (next: SelectionInfo | null) => {
      info = next;
    },
    /** Simulate the user picking a node in the Elements panel. */
    selectElement: (next: SelectionInfo | null) => {
      info = next;
      selectionListeners.forEach((cb) => cb());
    },
    deliverRuntime: (record: LifecycleRecord) =>
      runtimeListeners.forEach((cb) => cb(publicize(record))),
    deliverPort: (record: LifecycleRecord) =>
      ports.at(-1)?.messageCbs.forEach((cb) => cb(publicize(record))),
    deliverRaw: (message: unknown) =>
      runtimeListeners.forEach((cb) => cb(message)),
    dropPort: () => ports.at(-1)?.disconnectCbs.forEach((cb) => cb()),
    runtimeListenerCount: () => runtimeListeners.size,
    selectionListenerCount: () => selectionListeners.size,
  };
};

export const infoFor = (
  tag: string | null,
  id: string | null,
  lifecycles: LifecycleRecord[] = [],
  inspect: SelectionInfo["inspect"] = { neutron: null, quark: null },
): SelectionInfo => ({ id, tag, lifecycles, inspect });

export const recordFor = (
  seq: number,
  elementId: string,
  path: string[],
  meta: Record<string, unknown>,
): LifecycleRecord => ({
  seq,
  path,
  elementId,
  tag: "x-el",
  at: 1700000000000 + seq,
  meta,
});
