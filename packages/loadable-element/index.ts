import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export type LoadableLoadingEvent = TEvent & {
  type: "{tag}-loading";
  detail: void;
};

export type LoadableSuccessEvent<P = unknown> = TEvent & {
  type: "{tag}-success";
  detail: P;
};

export type LoadableErrorEvent<E = unknown> = TEvent & {
  type: "{tag}-error";
  detail: E;
};

/**
 * Composition base for the loading / success / error lifecycle every
 * "do async work, then publish" element shares — fetches, sheet loads,
 * template loads, third-party widget boots. Owns the three mutually
 * exclusive state attributes, the `provision` payload and the three
 * tag-prefixed events, so a concrete element only decides *when* work
 * starts and what it yields. Not a registered element on its own (tag is
 * intentionally `noop-tag`) — compose it via
 * `Neutron.compose([LoadableElement, …])`. Consumers include
 * `FetchableElement` (and through it `<provider-fetch>`, `<super-form>`,
 * `<web-authn>`) and `<quark-sheet>`.
 *
 * Subclasses drive it with three effects: `_setLoading: []`,
 * `_setSuccess: [provision]`, `_setError: [error]`; `_resetLoadState: []`
 * clears all three states without an event (a cancelled request).
 *
 * @summary Loading / success / error state + provision + events, once.
 *
 * @fires {tag}-loading - After `is-loading` is set (work started).
 * @type LoadableLoadingEvent
 * @fires {tag}-success - After `is-success` is set. `event.detail` is the
 *   new `provision`.
 * @type LoadableSuccessEvent
 * @fires {tag}-error - After `is-error` is set. `event.detail` is the
 *   error payload (also stored as `provision`).
 * @type LoadableErrorEvent
 */
export const LoadableElement = Neutron({
  tag: "noop-tag",
  events: {
    loading: {
      prefixWithTag: true,
    },
    success: {
      prefixWithTag: true,
    },
    error: {
      prefixWithTag: true,
    },
  },
  props: {
    // public state
    /**
     * @state
     * Work is in flight.
     */
    isLoading: Boolean,
    /**
     * @state
     * The most recent work finished successfully. Mutually exclusive with
     * `is-error`.
     */
    isSuccess: Boolean,
    /**
     * @state
     * The most recent work failed. Mutually exclusive with `is-success`.
     */
    isError: Boolean,
    /**
     * @provision
     * The result of the most recent work on success, or the error payload
     * on failure. Shape is defined by the composing element. Not
     * reflected as an attribute.
     */
    provision: Object as unknown as ConstructorType<unknown>,
  },
}).defineMethods({
  /** Enter the loading state and announce it. */
  _setLoading: () => ({
    isLoading: true,
    isSuccess: false,
    isError: false,
    emit: ["loading"],
  }),
  /** Publish `provision`, enter the success state and announce it. */
  _setSuccess: (_, provision: unknown) => [
    {
      isLoading: false,
      isSuccess: true,
      isError: false,
      provision,
    },
    { emit: ["success", { detail: provision }] },
  ],
  /** Store the error as `provision`, enter the error state and announce it. */
  _setError: (_, error: unknown) => [
    {
      isLoading: false,
      isSuccess: false,
      isError: true,
      provision: error,
    },
    { emit: ["error", { detail: error }] },
  ],
  /** Clear every state without an event, cancelled / superseded work. */
  _resetLoadState: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
  }),
});
