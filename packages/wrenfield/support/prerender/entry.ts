/**
 * The app in the prerenderer's window: Nucleus Kit's server entry (its
 * elements, and the hooks run around each page) with the app's own check
 * added to `afterRender`.
 */
import { afterRender as checkRoute } from "@excom/nucleus-kit/server";

export * from "@excom/nucleus-kit/server";

/**
 * The kit's check (a soft 404, a not-found path a route matches), then fails
 * a page whose data came back as an error: routes the catalogue no longer has.
 */
export const afterRender = (page: { url: string; notFound: boolean; document: Document }) => {
  checkRoute(page);
  const failed = page.document.querySelector("provider-fetch[is-error]");
  if (failed) throw new Error(`${page.url}: ${failed.getAttribute("api-url")} answered an error`);
};
