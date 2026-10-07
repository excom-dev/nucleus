import { createDom, type Dom } from "@excom/nucleus-dom";

/**
 * A window where markup parses and nothing loads: no stylesheet, script or
 * frame, and every request (`<link rel="preload" as="fetch">`) gets a
 * network error before it leaves. happy-dom's `DOMParser` documents are
 * live in their window (links preload, frames load, custom elements
 * upgrade), so markup that must stay as written parses in one of these.
 */
export const inertDom = (html?: string): Dom =>
  createDom({
    html,
    settings: {
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ window }) => window.Response.error(),
        },
      },
    },
  });
