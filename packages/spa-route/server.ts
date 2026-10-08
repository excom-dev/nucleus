/**
 * `@excom/spa-route/server`: the router's hooks for prerendering in Node
 * (`@excom/nucleus-ssr`), run around each page. Not for the browser.
 */
import { resetRouter } from "./src/reset-router";

/** Before a page parses: the router back to a cold load of the page's URL. */
export const beforeRender = ({ url }: { url: string }): void =>
  resetRouter(url);

/**
 * Once a page settled: fails a soft 404, a page only the fallback route
 * matches (a link to a page that is gone would be written as a page), and
 * a not-found page with no active `<spa-route is-fallback>`, whose
 * `404.html` would be an ordinary page. Only a fallback no other
 * `<spa-route>` contains decides, the outermost manager's: a nested
 * layout's own fallback is part of an ordinary page.
 */
export const afterRender = ({
  url,
  notFound,
  document,
}: {
  url: string;
  notFound: boolean;
  document: Document;
}): void => {
  const fallback = Array.from(
    document.querySelectorAll("spa-route[is-fallback][is-active]")
  ).some((route) => !route.parentElement?.closest("spa-route"));
  // a caller that says nothing means an ordinary page
  if (fallback === !!notFound) return;
  throw new Error(
    fallback
      ? `${url} matches no route`
      : `${url} is not the fallback route: the not-found page needs a <spa-route is-fallback> that matches it`
  );
};
