/**
 * The app in the prerenderer's window: Nucleus Kit's server build, and the
 * hooks run around each page.
 */
import { NOT_FOUND } from "./prerender.config";
import { Quark } from "@excom/nucleus-kit/server";
import { resetRouter } from "@excom/spa-route/testing";

// the renderer checks none of these got defined
export { SERVER_EXCLUDED_TAGS } from "@excom/nucleus-kit/server";

export const beforeRender = ({ url }: { url: string }) => resetRouter(url);

// `budgetMs` bounds the page; `whenSettled()` alone gives up after 1 s
export const settle = (): Promise<unknown> => Quark.whenSettled({ timeout: Infinity });

/**
 * Fails a route only the fallback route matches (a soft 404), a not-found
 * path a route matches, and a page whose data came back as an error: routes
 * the catalogue no longer has.
 */
export const afterRender = ({ url, document }: { url: string; document: Document }) => {
  const notFound = !!document.querySelector("spa-route[is-fallback][is-active]");
  if (notFound !== (url === NOT_FOUND)) throw new Error(notFound ? `${url} matches no route` : `${url} is not the fallback route`);
  const failed = document.querySelector("provider-fetch[is-error]");
  if (failed) throw new Error(`${url}: ${failed.getAttribute("api-url")} answered an error`);
};
