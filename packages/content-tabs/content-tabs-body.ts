import { Neutron } from "@excom/neutron";

/**
 * Panel paired with a `<content-tabs-header>` — shown when that header is
 * open. Lives inside a `<content-tabs>`.
 *
 * @summary Tab panel — visible when its paired header is open.
 */
export const ContentTabsBody = Neutron({
  tag: "content-tabs-body",
  props: {
    /**
     * @option
     * @state
     * Visibility, kept in sync with the paired header's `is-open`. Set
     * directly only if this body is not paired with a header.
     */
    isOpen: Boolean,
    /**
     * @option
     * Pairs this body with the `<content-tabs-header>` sharing the same
     * `tab-name`. Unset headers / bodies pair by position instead.
     */
    tabName: String,
  },
});
