import { Neutron } from "@excom/neutron";

/**
 * Composition base that owns an `AbortController` for cancellable async work. Subclasses call `doAbort()` to cancel in-flight operations and rotate a fresh controller. Used by `RenderableElement` (and thus `<include-content>`, `<spa-route>`) when template fetches are superseded.
 *
 * @summary AbortController ownership for Neutron elements.
 */
export const AbortableElement = Neutron({
  tag: "noop-tag",
  props: {
    // private state
    abortController: {
      type: AbortController,
      defaultValue: () => new AbortController(),
    },
  },
}).defineMethods({
  doAbort: ({ abortController }, reason?: any) => {
    abortController?.abort(reason);
    return { abortController: new AbortController() };
  },
});
