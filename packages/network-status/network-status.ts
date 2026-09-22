import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

interface NetworkConnection {
  readonly type?: string;
  readonly effectiveType?: string;
  readonly downlink?: number;
  readonly rtt?: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

declare global {
  interface Navigator {
    readonly connection?: NetworkConnection;
    readonly mozConnection?: NetworkConnection;
    readonly webkitConnection?: NetworkConnection;
  }
}

export interface NetworkStatusProvision {
  isOnline: boolean;
  connectionType?: string | null;
  effectiveType?: string | null;
  downlink?: number | null;
  rtt?: number | null;
  lastOnline?: number | null;
  lastOffline?: number | null;
}

export type NetworkStatusOnlineEvent = TEvent & {
  type: "network-status-online";
  detail: NetworkStatusProvision;
};

export type NetworkStatusOfflineEvent = TEvent & {
  type: "network-status-offline";
  detail: NetworkStatusProvision;
};

export type NetworkStatusChangeEvent = TEvent & {
  type: "network-status-change";
  detail: NetworkStatusProvision;
};

/**
 * Reports live network connectivity — `navigator.onLine` plus, where the
 * Network Information API is available, connection type and effective
 * speed. Reflects `is-mounted` so CSS can distinguish "not yet upgraded"
 * from a genuine offline state.
 *
 * The Network Information API (`connection-type` / `effective-type` /
 * `downlink` / `rtt`) is Chromium-only — unsupported in Safari and
 * Firefox, where those fields stay `null` and only `is-online` /
 * `network-status-online` / `network-status-offline` are meaningful. See
 * `INTERNAL.md` for known `navigator.onLine` reliability caveats.
 *
 * Nothing fires at mount — the first read only sets `is-online` and
 * `.provision`. Select on the attribute / read the provision for the
 * initial state; the events report transitions.
 *
 * @fires network-status-online - Dispatched on a transition from offline
 *   to online, never at mount. `event.detail` is the full `.provision`
 *   payload.
 * @type NetworkStatusOnlineEvent
 * @fires network-status-offline - Dispatched on a transition from online
 *   to offline, never at mount. `event.detail` is the full `.provision`
 *   payload.
 * @type NetworkStatusOfflineEvent
 * @fires network-status-change - Dispatched when connection details
 *   change without an online/offline transition (Network Information API
 *   only), never at mount. `event.detail` is the full `.provision`
 *   payload.
 * @type NetworkStatusChangeEvent
 */
export const NetworkStatus = Neutron({
  tag: "network-status",
  reflectDefaultProps: ["isMounted"],
  props: {
    // state
    /**
     * @provision
     * Full connectivity snapshot: `{ isOnline, connectionType,
     * effectiveType, downlink, rtt, lastOnline, lastOffline }`. Set at
     * mount and on every change; the same object dispatched as
     * `event.detail` on every fired event. `lastOnline` / `lastOffline`
     * are stamped on transitions only. Not reflected as an attribute.
     * @type NetworkStatusProvision
     */
    provision: Object as unknown as ConstructorType<NetworkStatusProvision>,
    /**
     * @state
     * Current `navigator.onLine` value.
     */
    isOnline: Boolean,
    /**
     * @state
     * Connection type (`wifi`, `cellular`, `ethernet`, …) from the
     * Network Information API. `null` where unsupported (Safari,
     * Firefox).
     */
    connectionType: String,
    /**
     * @state
     * Effective connection type (`4g`, `3g`, `2g`, `slow-2g`) from the
     * Network Information API. `null` where unsupported (Safari,
     * Firefox).
     */
    effectiveType: String,
    // private
    networkConnection: Object as unknown as ConstructorType<NetworkConnection>,
  },
})
  .defineMethods({
    setNetworkData: (
      { isOnline, networkConnection, provision },
      argData: { isOnline?: boolean } | undefined = {}
    ) => {
      const _isOnline = argData.isOnline ?? isOnline;
      /* `provision` is only set here, so its absence is the first read.
         A Boolean prop reads `false` before it's set, so `isOnline` alone
         can't tell "unset" from "offline". */
      const isFirstRead = !provision;
      const isOnlineChanged = !isFirstRead && isOnline !== _isOnline;
      const _connectionType = networkConnection?.type;
      const _effectiveType = networkConnection?.effectiveType;
      const newData = {
        isOnline: _isOnline,
        connectionType: _connectionType,
        effectiveType: _effectiveType,
        downlink: networkConnection?.downlink,
        rtt: networkConnection?.rtt,
        lastOnline:
          isOnlineChanged && _isOnline ? Date.now() : provision?.lastOnline,
        lastOffline:
          isOnlineChanged && !_isOnline ? Date.now() : provision?.lastOffline,
      };
      return {
        isOnline: _isOnline,
        connectionType: _connectionType,
        effectiveType: _effectiveType,
        provision: newData as NetworkStatusProvision,
        /* First read is state, not a transition: nothing fires at mount.
           After that: `online` / `offline` on a flip, `change` otherwise. */
        ...(isFirstRead
          ? {}
          : {
              emit: [
                `network-status-${
                  isOnlineChanged
                    ? _isOnline
                      ? "online"
                      : "offline"
                    : "change"
                }`,
                { detail: newData },
              ],
            }),
      };
    },
    handleOnline: () => ({
      setNetworkData: [{ isOnline: true }],
    }),
    handleOffline: () => ({
      setNetworkData: [{ isOnline: false }],
    }),
    handleChange: () => ({
      setNetworkData: [],
    }),
  })
  .onConnected(({ isMoving, handleOnline, handleOffline, handleChange }) => {
    // A move: keep the existing listeners
    if (isMoving) return;

    // Window + connection listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial `networkConnection`
    const networkConnection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    networkConnection?.addEventListener("change", handleChange);

    return [
      { networkConnection },
      {
        setNetworkData: [
          {
            isOnline: navigator.onLine,
          },
        ],
      },
    ];
  })
  .onDisconnected(
    ({
      isMoving,
      handleOnline,
      handleOffline,
      handleChange,
      networkConnection,
    }) => {
      // A move: keep the existing listeners
      if (isMoving) return;
      // Drop window + connection listeners
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      networkConnection?.removeEventListener("change", handleChange);
      return {
        networkConnection: null,
      };
    }
  );
