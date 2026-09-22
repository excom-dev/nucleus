import { KitLogger } from "@excom/kit-logger";
import { Neutron, TEvent } from "@excom/neutron";

export type ProviderStorageChangedEvent = TEvent & {
  type: "provider-storage-changed";
  detail: {
    /** The `key-name` whose stored value changed. */
    keyName: string;
    /** `provision` before the re-read (`null` when nothing was read). */
    oldValue: unknown;
    /** `provision` after the re-read (`null` when absent / not valid JSON). */
    newValue: unknown;
  };
};

type StoreProps = { keyName?: string | null; storeName?: string | null };

const getStore = (storeName?: string | null) =>
  storeName === "session" ? sessionStorage : localStorage;

/** Read `key-name` out of `store-name` as JSON → provision / state effect. */
const readStore = ({ keyName, storeName }: StoreProps) => {
  try {
    return {
      provision: JSON.parse(getStore(storeName).getItem(keyName!) || "null"),
      isSuccess: true,
      isError: false,
    };
  } catch (e) {
    KitLogger.error("provider-storage", e);
    return { provision: null, isSuccess: false, isError: true };
  }
};

/**
 * Reads a JSON value out of `localStorage` / `sessionStorage` under
 * `key-name` into `provision`. Read-only: it never writes. It re-reads
 * whenever `key-name` / `store-name` is set or changes, and — for
 * `localStorage` — whenever another tab writes the same key (the
 * browser's `storage` event). Same-tab writes do not fire `storage`,
 * so after your own `setItem` re-set `key-name` to force a read.
 *
 * @fires provider-storage-changed - Dispatched after a `storage` event
 *   from another tab for this element's `store-name` + `key-name` (or a
 *   `clear()` of that store) has been re-read into `provision` — so
 *   `provision`, `is-success` / `is-error` are already updated when it
 *   fires. The read also publishes `neutron-provision`, as usual.
 * @type ProviderStorageChangedEvent
 */
export const ProviderStorage = Neutron({
  tag: "provider-storage",
  props: {
    // options
    /**
     * @option
     * Storage key to read. Setting or changing it re-reads immediately
     * (parsed as JSON; `null` if absent). Removing it clears
     * `provision` and both states.
     * @values <storage key>
     */
    keyName: String,
    /**
     * @option
     * Which Web Storage area to read. `local` survives the tab / browser
     * closing and syncs across tabs; `session` is per-tab and gone when
     * the tab closes. Changing it re-reads `key-name` from the new store.
     * @values local, session
     * @default local
     */
    storeName: String,
    // state
    /**
     * @provision
     * `JSON.parse(store.getItem(keyName))`, or `null` if the key is
     * absent or the read failed. Not reflected as an attribute.
     */
    provision: Object,
    /**
     * @state
     * The last read (parse) succeeded — including a legitimately absent
     * key (`provision` is `null`, not an error).
     */
    isSuccess: Boolean,
    /**
     * @state
     * `JSON.parse` threw on the last read (the stored value isn't valid
     * JSON). `provision` is `null`.
     */
    isError: Boolean,
  },
})
  .defineMethods({
    // `storage` fires in *other* tabs only, for every key of every store.
    _handleStorage: (
      { keyName, storeName, provision }: StoreProps & { provision: unknown },
      e: StorageEvent
    ) => {
      if (!keyName || e.storageArea !== getStore(storeName)) return null;
      // `key === null` is `clear()`; it took this key with it
      if (e.key !== null && e.key !== keyName) return null;
      const next = readStore({ keyName, storeName });
      return {
        ...next,
        emit: [
          "provider-storage-changed",
          {
            detail: {
              keyName,
              oldValue: provision,
              newValue: next.provision,
            },
          },
        ],
      };
    },
  })
  // Tracked listener: Neutron drops it on disconnect and restores it on
  // reconnect / move, so no `isMoving` bookkeeping here.
  .onConnected(
    // @ts-ignore TODO defineMethods
    ({ _handleStorage }) => ({
      addListener: ["storage", _handleStorage, { target: window }],
    })
  )
  // One read per batch, whichever of the two changed (including first mount).
  .onEffect(["keyName", "storeName"], ({ keyName, storeName }, previous) =>
    keyName
      ? readStore({ keyName, storeName })
      : // `key-name` removed: nothing to show
        "keyName" in previous && {
          provision: null,
          isSuccess: false,
          isError: false,
        }
  );

// <provider-storage key-name="results"></provider-storage>
// <provider-storage key-name="draft" store-name="session"></provider-storage>
