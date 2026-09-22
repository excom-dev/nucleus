import { FetchableElement } from "@excom/fetchable-element";
import { Neutron, TEvent } from "@excom/neutron";

export type FetchArgs = [url: string, requestInit: RequestInit];

export type WebAuthnSubmitEvent = TEvent & {
  type: "web-authn-submit";
  detail: FetchArgs;
};

/** Native form `submit` this element intercepts, not a Neutron emit. */
export type WebAuthnNativeSubmitEvent = SubmitEvent & {
  type: "submit";
  bubbles: true;
  cancelable: true;
  composed: false;
};
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

/**
 * WebAuthn (passkey) registration or authentication, wired to a plain
 * `<form>`. On submit: fetches ceremony options from `options-url`,
 * passes them to the browser's WebAuthn prompt (via
 * `@simplewebauthn/browser`'s `startRegistration` / `startAuthentication`
 * — installed as a dependency of this package, no extra setup needed),
 * then posts the resulting credential to `verify-url`. Composes
 * `FetchableElement`, so `is-loading` / `is-success` / `is-error` / `provision`
 * and every request-building attribute are inherited — see that
 * package's docs for the full list.
 *
 * Chain a next step off `web-authn-success` — e.g. redirect, or trigger
 * a follow-up `<super-form>` — the same way you'd react to any
 * `{tag}-success` event.
 *
 * @summary Passkey register / authenticate wired to a `<form>`.
 *
 * @fires web-authn-submit - Internal — dispatched once the browser
 *   ceremony (register or authenticate) resolves, just before the
 *   verify-url fetch runs. The credential is the request body. Default
 *   action calls `doFetch()`.
 * @type WebAuthnSubmitEvent
 * @listens submit - The default action of the `<form>` matched by
 *   `form-ref`; prevented, then starts the ceremony.
 * @type WebAuthnNativeSubmitEvent
 * @command --submit - Starts the ceremony programmatically (`<button
 *   command="--submit" commandfor="…">`) — the only option when `form-ref`
 *   points to a form that isn't a descendant.
 * @default-action web-authn-submit - Calls `doFetch(url, requestInit)`
 *   with the event's detail (the verify-url request).
 *
 * @example
 * <web-authn options-url="/api/webauthn/register/options"
 *   verify-url="/api/webauthn/register/verify" start-method="register">
 *   <form><input name="username"><button type="submit">Register</button></form>
 * </web-authn>
 */
export const WebAuthn = Neutron.compose([
  FetchableElement,
  Neutron({
    tag: "web-authn",
    props: {
      // options
      /**
       * @option
       * CSS selector for the `<form>` to intercept. Must be a
       * descendant to be heard directly — point elsewhere and invoke
       * the `--submit` command instead.
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
       * HTTP method used for both the `options-url` and `verify-url`
       * requests.
       * @default POST
       */
      apiMethod: {
        type: String,
        defaultValue: () => "POST",
      },
      /**
       * @option
       * Endpoint that returns the WebAuthn ceremony options JSON (from
       * your server's `generateRegistrationOptions` /
       * `generateAuthenticationOptions`). Fetched first, before the
       * browser prompt appears.
       * @values <URL>
       */
      optionsUrl: String,
      /**
       * @option
       * Which WebAuthn ceremony to run.
       * @values register | authenticate
       */
      startMethod: String,
      /**
       * @option
       * Endpoint that verifies the credential produced by the browser
       * prompt (your server's `verifyRegistrationResponse` /
       * `verifyAuthenticationResponse`). Receives the credential as the
       * request body.
       * @values <URL>
       */
      verifyUrl: String,
      // private
      optionsPromise: Promise,
    },
  }),
])
  .defineMethods({
    doSubmit: ({
      verifyUrl,
      optionsUrl,
      startMethod,
      apiMethod,
      getFetchArgs,
      getFormElement,
    }) => {
      const formElement = getFormElement();
      if (!verifyUrl || !optionsUrl || !startMethod || !formElement) {
        console.error("Missing required attributes for WebAuthn");
        return {
          emit: [
            "error",
            { detail: "Missing required attributes for WebAuthn" },
          ],
        };
      }

      return {
        isLoading: true,
        optionsPromise: doAuth({
          fetchArgs: getFetchArgs([optionsUrl, { method: apiMethod }]),
          startMethod,
        }),
      };
    },
  })
  .onEvent("submit", (_, e) => {
    e.preventDefault();
    return { doSubmit: [] };
  })
  .onCommand("--submit", () => ({ doSubmit: [] }))
  .onEventDefault("web-authn-submit", (_, { detail }) => ({
    // `detail` is the `[url, requestInit]` tuple (`onPromiseResolved`
    // below). `doFetch` takes that tuple as one arg.
    doFetch: [detail],
  }))
  .onPromiseResolved(
    "optionsPromise",
    ({ verifyUrl, apiMethod, getFetchArgs }, result) => ({
      emit: [
        "web-authn-submit",
        {
          detail: getFetchArgs([
            verifyUrl,
            { method: apiMethod, body: result.optionsPromise },
          ]),
        },
      ],
    })
  )
  .onPromiseRejected("optionsPromise", (_, result) => {
    console.error("WebAuthn error:", result.optionsPromise);
    return {
      emit: [
        "error",
        {
          detail: {
            message:
              result.optionsPromise instanceof Error
                ? result.optionsPromise.message
                : "WebAuthn operation failed",
          },
        },
      ],
    };
  });

async function doAuth({
  fetchArgs,
  startMethod,
}: {
  fetchArgs: [string, RequestInit];
  startMethod: string;
}) {
  // 1. Call the optionsUrl endpoint to get the options
  const response = await fetch(fetchArgs[0], {
    ...fetchArgs[1],
    body: JSON.stringify(fetchArgs[1].body),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch options: ${response.statusText}`);
  }

  const options = await response.json();

  let payload;
  if (startMethod === "register") {
    payload = await startRegistration({ optionsJSON: options });
  } else if (startMethod === "authenticate") {
    payload = await startAuthentication({ optionsJSON: options });
  } else {
    throw new Error(
      `Invalid startMethod: ${startMethod}. Must be 'register' or 'authenticate'`
    );
  }

  return payload;
}
