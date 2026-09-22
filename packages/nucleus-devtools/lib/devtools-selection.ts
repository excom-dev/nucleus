import { createBrowserAdapter, type DevtoolsAdapter } from "./devtools-adapter";
import type { SelectionSnapshot, SelectionState } from "./protocol";
import { SelectionSource } from "./selection-source";
import { ConstructorType, Neutron } from "@excom/neutron";

let adapterFactory: () => DevtoolsAdapter = () => createBrowserAdapter();

/** Swap the extension-API adapter (tests hand in a fake). */
export const setDevtoolsAdapterFactory = (factory: () => DevtoolsAdapter) => {
  adapterFactory = factory;
};

/** Event that asks the Adapter to copy the page's `dump()` to the clipboard. */
export const DUMP_EVENT = "devtools-selection-dump";
/** How long `did-copy` stays set after a successful copy. */
export const DID_COPY_MS = 1500;

let writeClipboard: (text: string) => Promise<void> = (text) =>
  navigator.clipboard.writeText(text);

/** Swap the clipboard writer (tests hand in a spy). */
export const setClipboardWriter = (writer: typeof writeClipboard) => {
  writeClipboard = writer;
};

/**
 * The pane's one Adapter: it bridges the extension API (Elements-panel selection,
 * `inspectedWindow.eval`, the keepalive port) and publishes what it learns
 * as State. Everything visible is orchestrated from these by Quark.
 *
 * @summary Tracks `$0` and publishes its DevTools history as a provision.
 */
export const DevtoolsSelection = Neutron({
  tag: "devtools-selection",
  props: {
    /**
     * @state
     * `empty` (nothing selected), `unavailable` (page API missing — reload
     * the tab), or `selected`.
     * @values empty | unavailable | selected
     */
    selectionState: String as unknown as ConstructorType<SelectionState>,
    /**
     * @state
     * Tag name of the selected element.
     */
    selectionTag: String,
    /**
     * @state
     * The selected element has an id in the page probe, i.e. it published
     * at least once.
     */
    hasPublications: Boolean,
    /**
     * @state
     * Set for a moment after `devtools-selection-dump` copied the page's
     * agent-tools bug report (`tools.dump()`) to the clipboard.
     */
    didCopy: Boolean,
    /**
     * @provision
     * `{ state, tag, hasPublications, records, inspect }` — publication
     * history for the selection plus the producers' current-value snapshots.
     * @type SelectionSnapshot
     */
    provision: Object as unknown as ConstructorType<SelectionSnapshot>,
    // private
    _source: Object as unknown as ConstructorType<SelectionSource>,
  },
})
  .defineMethods({
    _applySnapshot: (_element, snapshot: SelectionSnapshot) => ({
      selectionState: snapshot.state,
      selectionTag: snapshot.tag,
      hasPublications: snapshot.hasPublications,
      provision: snapshot,
    }),
    /**
     * Copy the page's `dump()` (state, sheets, diagnostics, trace) to the
     * clipboard. Async, so it is a method: it needs the live element after
     * the eval settles. Nothing to copy (no page API) leaves `did-copy` unset.
     */
    _copyDump: (element) => {
      void (async () => {
        try {
          const json = await element._source?.dump();
          if (!json) return;
          await writeClipboard(json);
          element.didCopy = true;
          setTimeout(() => {
            element.didCopy = false;
          }, DID_COPY_MS);
        } catch {
          element.didCopy = false;
        }
      })();
    },
  })
  /** @listens devtools-selection-dump @type Event — copy the bug report. */
  .onEvent(DUMP_EVENT, (element, event) => {
    event.stopPropagation();
    element._copyDump();
  })
  .onConnected((element) => {
    // A synchronous move keeps the running source (see onDisconnected).
    if (element._source) return;
    const source = new SelectionSource(adapterFactory(), (snapshot) =>
      element._applySnapshot(snapshot),
    );
    source.start();
    return { _source: source };
  })
  .onDisconnected(({ _source, isMoving }) => {
    if (isMoving) return;
    _source?.stop();
    return { _source: null };
  });

/** Define `<devtools-selection>` once (the pane entry and tests both call this). */
export const defineDevtoolsSelection = () => {
  if (!customElements.get("devtools-selection")) DevtoolsSelection.define();
};
