import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export type ContentTabsHeaderOpenedEvent = TEvent & {
  type: "content-tabs-header-opened";
  detail: void;
};

/**
 * Clickable tab header — lives inside a `<content-tabs>`. Click opens
 * (`single` / `toggle`) or toggles (`multi`) `is-open`, which keeps the
 * paired `<content-tabs-body>` in sync.
 *
 * @summary Tab header — opens its paired body on click.
 *
 * @fires content-tabs-header-opened - Whenever `is-open` is set. The
 *   parent `<content-tabs>` listens for this to close sibling headers.
 * @type ContentTabsHeaderOpenedEvent
 */
export const ContentTabsHeader = Neutron({
  tag: "content-tabs-header",
  props: {
    /**
     * @option
     * Pairs this header with the `<content-tabs-body>` sharing the same
     * `tab-name`. Unset headers / bodies pair by position instead.
     */
    tabName: String,
    /**
     * @option
     * @state
     * Open state. Click sets or toggles this depending on the parent's
     * `tab-type`; set it directly to drive the tab programmatically.
     */
    isOpen: Boolean,
    // private state
    _parentTabs:
      HTMLElement as unknown as ConstructorType<HTMLContentTabsElement>,
  },
})
  .defineMethods({
    _getParentTabs: (element) => {
      const tabs = element._parentTabs || element.closest("content-tabs");
      return [tabs && { _parentTabs: tabs }, { returns: tabs }];
    },
    _handleClick: (element) => ({
      isOpen: ["toggle", "multi"].includes(
        // @ts-expect-error - TODO: method typing
        element._getParentTabs()?.tabType as string
      )
        ? !element.isOpen
        : true,
    }),
    _syncCorrespondingBody: (element) => {
      // @ts-expect-error - TODO: method typing
      element._getParentTabs()?._queueSyncBody(element);
    },
  })
  .onPropUnset("isOpen", () => [{ _syncCorrespondingBody: [] }])
  .onPropSet("isOpen", () => [
    { _syncCorrespondingBody: [] },
    { emit: ["content-tabs-header-opened"] },
  ])
  .onEvent("click", () => ({ _handleClick: [] }))
  .onDisconnected(() => ({ _parentTabs: null }));
