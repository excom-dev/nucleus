import { AbortableElement } from "@excom/abortable-element";
import { KitLogger } from "@excom/kit-logger";
import {
  deepMerge,
  deleteUndefined,
  formToJson,
  jsonToSearchParams,
  mergeSearchParamsIntoUrl,
  selectOne,
} from "@excom/kit-utils";
import { LoadableElement } from "@excom/loadable-element";
import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export type FetchResponse = {
  bodyUsed: boolean;
  headers: [string, string][];
  ok: boolean;
  redirected: boolean;
  status: number;
  statusText: string;
  type: ResponseType;
  url: string;
  body: unknown;
};

type FetchInit = {
  url: string;
  payload: unknown;
  requestInit: RequestInit;
};

export type FetchError = FetchResponse | { message: string; stack?: string };

export type FetchableLoadingEvent = TEvent & {
  type: "{tag}-loading";
  detail: void;
};

export type FetchableSuccessEvent = TEvent & {
  type: "{tag}-success";
  detail: FetchResponse;
};

export type FetchableErrorEvent = TEvent & {
  type: "{tag}-error";
  detail: FetchError;
};

/**
 * Composition base that owns the request lifecycle for `fetch()`-backed
 * elements — building request args (attributes, a referenced `<form>`, or
 * a custom override), tracking loading / success / error state (through
 * `LoadableElement`), and canceling in-flight requests (via
 * `AbortableElement`) when superseded or disconnected. Not a registered element on its own (tag is intentionally
 * `noop-tag`) — compose it via `Neutron.compose([FetchableElement, ...])`
 * and the consumer element inherits every attribute, state, and event
 * declared below. Concrete consumers include `<provider-fetch>`
 * (fetch-on-attribute-change), `<super-form>` (fetch-on-submit), and
 * `<web-authn>` (WebAuthn ceremonies that still round-trip to a server).
 *
 * Subclasses call `doFetch(url, requestInit)` — typically built via
 * `getFetchArgs(customFetchArgs?)`, which deep-merges (lowest → highest
 * priority) the element's own attributes, the `<form>` referenced by
 * `form-ref` (action/method/enctype/fields), and any custom args passed
 * in — to run the request and drive `is-loading` / `is-success` /
 * `is-error` / `provision` automatically. A prior in-flight request is
 * canceled before a new one starts.
 *
 * @fires {tag}-loading - Dispatched immediately before the request is
 *   sent.
 * @type FetchableLoadingEvent
 * @fires {tag}-success - Dispatched when the request resolves
 *   successfully. `event.detail` is the parsed response (see `provision`).
 * @type FetchableSuccessEvent
 * @fires {tag}-error - Dispatched when the request fails — non-2xx
 *   status, network error, or a thrown error. `event.detail` is the
 *   error payload (see `provision`). Not dispatched for aborted requests.
 * @type FetchableErrorEvent
 */
export const FetchableElement = Neutron.compose([
  AbortableElement,
  LoadableElement,
  Neutron({
    tag: "noop-tag",
    /* `provision` and the loading / success / error events come from
       LoadableElement. Props below are redeclared only to document the
       request-specific meaning. */
    props: {
      // options
      /**
       * @option
       * CSS selector for a `<form>` to source the request from — its
       * `action` (URL), `method`, `enctype` (Content-Type), and field
       * values (as the JSON payload) all take priority over the
       * matching attributes below. Omit to build the request entirely
       * from attributes / custom `doFetch()` args.
       * @values <CSS Selector>
       */
      formRef: String,
      /**
       * @option
       * Force a request body even for methods that don't imply one
       * (`GET` / `HEAD`). Already implied for `POST` / `PUT` / `PATCH`.
       */
      hasBody: Boolean,
      /**
       * @option
       * Endpoint URL. When the request has no body, the JSON payload
       * (from `form-ref` or custom `doFetch()` args) is merged in as
       * query params instead.
       * @default ""
       */
      apiUrl: {
        type: String,
        defaultValue: () => "",
      },
      /**
       * @option
       * HTTP method. Always uppercased before the request is sent.
       * @default GET
       */
      apiMethod: {
        type: String,
        defaultValue: () => "GET",
      },
      // headers
      /**
       * @option
       * `Accept` request header.
       * @default application/json
       */
      headerAccept: {
        type: String,
        defaultValue: () => "application/json",
      },
      /**
       * @option
       * `Content-Type` request header. Dropped entirely when the
       * request has no body.
       * @default application/json
       */
      headerContentType: {
        type: String,
        defaultValue: () => "application/json",
      },
      /**
       * @option
       * `Cache-Control` request header. Unset by default (browser
       * default caching applies).
       */
      headerCacheControl: {
        type: String,
        defaultValue: () => null,
      },
      // fetch options
      /**
       * @option
       * `RequestInit.redirect` mode. Unset defers to the browser
       * default (`follow`).
       * @values follow | error | manual
       */
      fetchRedirect: {
        type: String,
        defaultValue: () => null,
      },
      /**
       * @option
       * `RequestInit.credentials` mode.
       * @default include
       * @values omit | same-origin | include
       */
      fetchCredentials: {
        type: String,
        defaultValue: () => "include",
      },

      // public state
      /**
       * @state
       * A request is currently in flight.
       */
      isLoading: Boolean,
      /**
       * @state
       * The most recent request resolved successfully. Mutually
       * exclusive with `is-error`.
       */
      isSuccess: Boolean,
      /**
       * @state
       * The most recent request failed (non-2xx status, network
       * error, or a thrown error other than `AbortError`). Fires with
       * the `error` event.
       */
      isError: Boolean,
      /**
       * @provision
       * Response payload on success, or error payload on failure.
       * Success shape: `{ status, statusText, ok, headers, url,
       * redirected, bodyUsed, type, body }`. Failure shape is either
       * that same response shape (server responded with an error
       * status) or `{ message, stack }` (request never completed).
       * Not reflected as an attribute.
       * @type FetchResponse
       */
      provision: Object as unknown as ConstructorType<FetchResponse>,

      // internal state
      fetchPromise: Promise,
    },
  }),
])
  .defineMethods({
    doFetch: ({ fetchPromise }, fetchArgs: [string, RequestInit]) =>
      fetchArgs.length === 2 && [
        fetchPromise && { setCanceledState: [] },
        {
          setLoadingState: [fetchArgs[0], fetchArgs[1]],
        },
      ],
    setLoadingState: (
      { abortController },
      url: string,
      reqInit: RequestInit = {}
    ) => [
      {
        fetchPromise: callFetch(url, {
          signal: abortController.signal,
          ...reqInit,
          ...(reqInit.body ? { body: JSON.stringify(reqInit.body) } : {}),
        }),
      },
      { _setLoading: [] },
    ],
    setCanceledState: () => [
      {
        doAbort: [],
      },
      { fetchPromise: null },
      { _resetLoadState: [] },
    ],
    setSuccessState: (_, provision: any) => [
      { fetchPromise: null },
      { _setSuccess: [provision] },
    ],
    setErrorState: ({ localName }, provision: any) => {
      KitLogger.error(`Element error: ${localName} - `, provision);
      return [{ fetchPromise: null }, { _setError: [provision] }];
    },
    getFormElement: (element) => ({
      returns: element.formRef
        ? element.formRef === ":scope form"
          ? // Default `:scope form`: `querySelector` is cheaper than global `selectOne`
            // (`selectOne` would still work)
            element.querySelector("form")
          : selectOne(element.formRef, { scope: element })
        : null,
    }),
    getFetchArgs: (
      {
        apiMethod,
        apiUrl,
        hasBody,
        headerAccept,
        headerContentType,
        headerCacheControl,
        fetchRedirect,
        fetchCredentials,
        // @ts-expect-error
        getFormElement,
      },
      customFetchArgs: [string, RequestInit]
    ): [string, RequestInit] => {
      const form = getFormElement();
      const fetchInit: FetchInit = deepMerge(
        // Defaults (lowest priority): the element's own attributes
        {
          url: apiUrl,
          payload: {},
          requestInit: {
            method: apiMethod,
            headers: {
              Accept: headerAccept || undefined,
              "Content-Type": headerContentType || undefined,
              "Cache-Control": headerCacheControl || undefined,
            },
            credentials: fetchCredentials || undefined,
            redirect: fetchRedirect || undefined,
          },
        },
        // Form data (medium priority)
        form &&
          deleteUndefined(
            {
              // Attrs, not methods: ignore the form's defaults (we have our own)
              url: form.getAttribute("action") || undefined,
              payload: formToJson(form),
              requestInit: {
                method: form.getAttribute("method") || undefined,
                headers: {
                  "Content-Type": form.getAttribute("enctype") || undefined,
                },
              },
            },
            { nested: true }
          ),
        // Custom fetch args (highest priority)
        {
          ...(customFetchArgs?.[0] ? { url: customFetchArgs?.[0] } : {}),
          requestInit: customFetchArgs?.[1] || {},
        }
      );

      // Uppercase the method
      fetchInit.requestInit.method =
        fetchInit.requestInit.method!.toUpperCase();

      // Does this request have a body?
      const _hasBody =
        hasBody ||
        ["POST", "PUT", "PATCH"].includes(fetchInit.requestInit.method || "");

      // Merge search params into the URL
      const url = mergeSearchParamsIntoUrl(
        fetchInit.url,
        _hasBody ? new URLSearchParams() : jsonToSearchParams(fetchInit.payload)
      );

      // No body in args: build it from the payload
      if (!fetchInit.requestInit.body) {
        fetchInit.requestInit.body = fetchInit.payload as BodyInit;
      }

      if (!_hasBody) {
        delete fetchInit.requestInit.body;
        delete fetchInit.requestInit.headers!["Content-Type"];
      }

      return {
        // @ts-ignore TODO need to type `returns`
        returns: [
          url,
          deleteUndefined(fetchInit.requestInit, { nested: true }),
        ],
      };
    },
  })
  .onPromiseResolved("fetchPromise", (_, result) => ({
    setSuccessState: [result.fetchPromise],
  }))
  .onPromiseRejected("fetchPromise", (_, result) => ({
    setErrorState: [result.fetchPromise],
  }))
  .onDisconnected(
    ({ fetchPromise, isMoving }) =>
      !isMoving &&
      fetchPromise && {
        setCanceledState: [],
      }
  );

async function callFetch(
  url: string,
  options: RequestInit
): Promise<FetchResponse | undefined> {
  let responseData;
  try {
    const response = await fetch(url, options);
    responseData = {
      bodyUsed: response.bodyUsed,
      headers: Array.from(response.headers.entries()),
      ok: response.ok,
      redirected: response.redirected,
      status: response.status,
      statusText: response.statusText,
      type: response.type,
      url: response.url,
      body: response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : await response.text(),
    };
    if (responseData.status >= 400) {
      throw new Error("Response error code: " + responseData.status);
    }
    return responseData;
  } catch (error) {
    if (error?.name !== "AbortError") {
      // Prefer the error response; otherwise it's a thrown / programmatic error
      const errorData = responseData || {
        message: error.message,
        stack: error.stack,
      };
      KitLogger.error("Element error: ", error);
      throw errorData;
    } else {
      KitLogger.debug("Fetch request was aborted");
    }
  }
}
