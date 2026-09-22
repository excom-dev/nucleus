import { FetchableElement } from "@excom/fetchable-element";
import { Neutron, TEvent } from "@excom/neutron";

export type FetchArgs = [url: string, requestInit: RequestInit];

export type ProviderFetchSubmitEvent = TEvent & {
  type: "provider-fetch-submit";
  detail: FetchArgs;
};

/**
 * Zero-JS `fetch()` — composes `FetchableElement` and auto-fetches
 * whenever `api-url` is set (or changes) while not `is-paused`. Re-fetch
 * on demand with the `--fetch` command: a `<button command="--fetch"
 * commandfor="…">`, or `<event-handler command-name="--fetch"
 * target-ref="…">` to relay any event.
 *
 * All request-building attributes (`api-method`, headers, `form-ref`,
 * …) and lifecycle state (`is-loading` / `is-success` / `is-error` /
 * `provision`) are inherited from `FetchableElement` — see that package's
 * docs for the full attribute list.
 *
 * @fires provider-fetch-submit - Internal — dispatched whenever a fetch
 *   is about to run (auto-fetch or `--fetch`). Built by
 *   `getFetchArgs()`. Cancelable; default action calls `doFetch()`.
 * @type ProviderFetchSubmitEvent
 * @command --fetch - Re-runs the request with the current attributes,
 *   even while `is-paused`.
 * @default-action provider-fetch-submit - Calls `doFetch(url,
 *   requestInit)` with the event's detail.
 */
export const ProviderFetch = Neutron.compose([
  FetchableElement,
  Neutron({
    tag: "provider-fetch",
    props: {
      /**
       * @option
       * Pause auto-fetch. While set, `api-url` changes are ignored;
       * the `--fetch` command still works.
       */
      isPaused: Boolean,
    },
  }),
])
  .onPropChanged(
    ["apiUrl", "isPaused"],
    ({ apiUrl, isPaused, getFetchArgs }) =>
      apiUrl &&
      !isPaused && {
        emit: ["provider-fetch-submit", { detail: [getFetchArgs()] }],
      }
  )
  .onCommand("--fetch", ({ getFetchArgs }) => ({
    emit: ["provider-fetch-submit", { detail: [getFetchArgs()] }],
  }))
  .onEventDefault("provider-fetch-submit", (_, { detail }) => ({
    doFetch: [detail[0], detail[1]],
  }));
