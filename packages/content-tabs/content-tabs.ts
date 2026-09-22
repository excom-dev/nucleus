import type { ContentTabsBody } from "./content-tabs-body";
import type {
  ContentTabsHeader,
  ContentTabsHeaderOpenedEvent,
} from "./content-tabs-header";
import { ConstructorType, Neutron } from "@excom/neutron";

export type { ContentTabsHeaderOpenedEvent };

type TContentTabsHeader = typeof ContentTabsHeader.CustomElement;
type TContentTabsBody = typeof ContentTabsBody.CustomElement;

/**
 * Open state of a `<content-tabs>` group. A tab is its header's
 * `tab-name`, or its index among the group's own headers when unnamed.
 * Nested groups are excluded.
 */
export interface ContentTabsProvision {
  /** The group's `tab-type` (`null` when unset, behaves as `single`). */
  tabType: string | null;
  /** Every open tab, in header order. */
  openTabs: Array<string | number>;
  /** The first open tab; `null` when none is open. */
  activeTab: string | number | null;
}

/** A header's provision id: its `tab-name`, or its index among `headers`. */
const tabIdOf = (header: TContentTabsHeader, headers: TContentTabsHeader[]) =>
  header.tabName || headers.indexOf(header);

/** Read `is-open` even if the header hasn't upgraded yet. */
const isHeaderOpen = (header: TContentTabsHeader) =>
  header.isOpen ?? header.hasAttribute("is-open");

const isSameProvision = (
  a: ContentTabsProvision | null | undefined,
  b: ContentTabsProvision
) =>
  !!a &&
  a.tabType === b.tabType &&
  a.activeTab === b.activeTab &&
  a.openTabs.length === b.openTabs.length &&
  a.openTabs.every((tab, i) => tab === b.openTabs[i]);

/**
 * Tabs / accordion primitive. Click a `<content-tabs-header>` to show its
 * paired `<content-tabs-body>` — pair by matching `tab-name`, or by
 * position when both are unnamed. Nested `<content-tabs>` groups are
 * isolated from their ancestors.
 *
 * `.provision` holds the open state (`{ tabType, openTabs, activeTab }`)
 * so Quark can read which tab is active with `prop("provision")`.
 *
 * @summary Tabs / accordion — single, multi, or toggle selection.
 *
 * @listens content-tabs-header-opened - Closes sibling headers when
 *   `tab-type` is `single` (default) or `toggle`.
 * @type ContentTabsHeaderOpenedEvent
 *
 * @child content-tabs-header - Clickable tab headers.
 * @child content-tabs-body - Panels shown / hidden to match their header.
 */
export const ContentTabs = Neutron({
  tag: "content-tabs",
  props: {
    /**
     * @option
     * Selection mode. `single` opens one header at a time (radio-like);
     * `multi` allows any number open at once (accordion); `toggle` is
     * like `single`, but re-clicking the open header closes it.
     * @values single | multi | toggle
     * @default single
     */
    tabType: String,
    /**
     * @provision
     * Open state: `{ tabType, openTabs, activeTab }`. A tab is its
     * header's `tab-name`, or its index among this group's own headers
     * when unnamed; `activeTab` is the first open one (`null` when none).
     * Set after mount and after every header change (batched with the
     * body sync). Not reflected as an attribute.
     * @type ContentTabsProvision
     */
    provision: Object as unknown as ConstructorType<ContentTabsProvision>,

    // private state
    _headersToSync: Array as unknown as ConstructorType<TContentTabsHeader[]>,
    _mutationQueued: Boolean,
  },
})
  .defineMethods({
    /* Own headers / bodies only. A nested `<content-tabs>` keeps its own
       (nearest-group filter, not `:not(:scope …)`, which some selector
       engines scope wrong). */
    getHeaders: (element) => ({
      returns: [...element.querySelectorAll("content-tabs-header")].filter(
        (header) => header.closest("content-tabs") === element
      ) as TContentTabsHeader[],
    }),
    getBodies: (element) => ({
      returns: [...element.querySelectorAll("content-tabs-body")].filter(
        (body) => body.closest("content-tabs") === element
      ) as TContentTabsBody[],
    }),
    // @ts-expect-error - TODO: method typing
    _syncBodies: ({ _headersToSync, getHeaders, getBodies }) => {
      const allHeaders = getHeaders();
      const allBodies = getBodies();
      [...new Set(_headersToSync || [])].forEach((header) => {
        const body = allBodies.find((body, bodyIndex) => {
          if (header.tabName) {
            return body.tabName === header.tabName;
          }
          return bodyIndex === allHeaders.indexOf(header);
        });
        if (body) {
          body.isOpen = header.isOpen;
        }
      });
      return {
        _headersToSync: [],
        _mutationQueued: false,
        _syncProvision: [],
      };
    },
    /**
     * Rebuild `provision` from every own header (group-wide, once per
     * batch). New object only when something changed, so Quark /
     * `neutron-provision` listeners skip no-op batches.
     */
    // @ts-expect-error - TODO: method typing
    _syncProvision: ({ getHeaders, tabType, provision }) => {
      const headers = getHeaders();
      const openTabs = headers
        .filter(isHeaderOpen)
        .map((header) => tabIdOf(header, headers));
      const next: ContentTabsProvision = {
        tabType: tabType || null,
        openTabs,
        activeTab: openTabs.length ? openTabs[0] : null,
      };
      return isSameProvision(provision, next) ? {} : { provision: next };
    },
    // @ts-expect-error - TODO: method typing
    _queueSyncBodies: ({ _mutationQueued, _syncBodies }) => {
      if (!_mutationQueued) {
        // Heavy DOM queries: cache and batch.
        queueMicrotask(_syncBodies);
        return { _mutationQueued: true };
      }
    },
    _queueSyncBody: ({ _headersToSync }, header) => [
      { _headersToSync: [...(_headersToSync || []), header] },
      { _queueSyncBodies: [] },
    ],
  })
  .onEvent("content-tabs-header-opened", (element, e) => {
    // Close sibling headers
    e.stopPropagation();
    if ([null, "single", "toggle"].includes(element.tabType)) {
      element
        .getHeaders()
        // `e.target` is the header that opened
        .filter((header) => header !== e.target)
        .forEach((header) => (header.isOpen = false));
    }
  })
  // Initial `is-open` headers may upgrade after this element, so the
  // first provision read shares the same microtask queue as a change
  .onConnected(() => ({ _queueSyncBodies: [] }))
  .onDisconnected(
    ({ isMoving }) =>
      !isMoving && { _headersToSync: null, _mutationQueued: false }
  );
