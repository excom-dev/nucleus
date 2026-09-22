import { FetchableElement } from "@excom/fetchable-element";
import { Neutron, TEvent } from "@excom/neutron";

export type FetchArgs = [url: string, requestInit: RequestInit];

export type SuperFormSubmitEvent = TEvent & {
  type: "super-form-submit";
  detail: FetchArgs;
};

/** Native form `submit` this element intercepts, not a Neutron emit. */
export type SuperFormNativeSubmitEvent = SubmitEvent & {
  type: "submit";
  bubbles: true;
  cancelable: true;
  composed: false;
};

/**
 * Turns a plain `<form>` into a zero-JS `fetch()` submit — intercepts
 * `submit`, converts the form's fields into a JSON payload (see
 * `formToJson()` below), and sends it to the form's `action` (or
 * `api-url` / `api-method`, if no `form-ref` form is found). Composes
 * `FetchableElement`, so `is-loading` / `is-success` / `is-error` / `provision`
 * and every request-building attribute (headers, credentials, …) are
 * inherited — see that package's docs for the full list.
 *
 * Form field `name`s become JSON keys: dot-separated names nest
 * (`address.city` → `{ address: { city } }`) and a trailing `[]` collects
 * same-named fields into an array (`tags[]` → `{ tags: [...] }`).
 *
 * @summary Zero-JS `fetch()` submit for a plain `<form>`.
 *
 * @fires super-form-submit - Internal — dispatched whenever a submit is
 *   about to run (real `submit` or the `--submit` command). Built by
 *   `getFetchArgs()`. Cancelable; default action calls `doFetch()`.
 * @type SuperFormSubmitEvent
 * @listens submit - The default action of the `<form>` matched by
 *   `form-ref` (or any descendant `<form>`); prevented, then converted
 *   into `super-form-submit`.
 * @type SuperFormNativeSubmitEvent
 * @command --submit - Submits programmatically (`<button command="--submit"
 *   commandfor="…">`) — the only option when `form-ref` points to a form
 *   that isn't a descendant, since this element can't hear its `submit`
 *   event directly.
 * @default-action super-form-submit - Calls `doFetch(url, requestInit)`
 *   with the event's detail.
 *
 * @example
 * <super-form>
 *   <form action="/api/signup" method="post">
 *     <input name="email" type="email" required>
 *     <button type="submit">Sign up</button>
 *   </form>
 * </super-form>
 */
export const SuperForm = Neutron.compose([
  FetchableElement,
  Neutron({
    tag: "super-form",
    props: {
      /**
       * @option
       * CSS selector for the `<form>` to intercept. The form's
       * `action` / `method` / `enctype` take priority over `api-url` /
       * `api-method` below. Must be a descendant to be heard directly —
       * point elsewhere and invoke the `--submit` command instead.
       * @default :scope form
       * @values <CSS Selector>
       */
      formRef: {
        type: String,
        // Non-descendant form: this element won't hear `submit`; invoke `--submit`
        defaultValue: () => ":scope form",
      },
      /**
       * @option
       * HTTP method used when the form itself has no `method`.
       * @default POST
       */
      apiMethod: {
        type: String,
        defaultValue: () => "POST",
      },
    },
  }),
])
  .onEvent("submit", ({ getFetchArgs }, e) => {
    // Block the native submit
    e.preventDefault();
    return {
      emit: ["super-form-submit", { detail: [getFetchArgs()] }],
    };
  })
  .onCommand("--submit", ({ getFetchArgs }) => ({
    emit: ["super-form-submit", { detail: [getFetchArgs()] }],
  }))
  .onEventDefault("super-form-submit", (_, { detail }) => ({
    doFetch: [detail[0], detail[1]],
  }));
