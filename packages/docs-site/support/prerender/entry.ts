/**
 * The site in the prerenderer's window: Nucleus Kit's server build, Quark
 * `@use` modules from `dist`, and the hooks run around each page.
 */
import { DIST, NOT_FOUND } from "./prerender.config";
import type { RenderPage } from "@excom/nucleus-ssr";
import { Quark } from "@excom/quark";
import { resetRouter } from "@excom/spa-route/testing";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// the renderer checks none of these got defined
export { SERVER_EXCLUDED_TAGS } from "@excom/nucleus-kit/server";

/** The built file a `@use` URL serves: an extensionless one is `<path>.js` (`_redirects`). */
export const moduleFile = (url: string): string => {
  const { origin, pathname } = new URL(url, location.origin);
  if (origin !== location.origin)
    throw new Error(`${url} is not a module of this site`);
  const file = /\.[^/]+$/.test(pathname) ? pathname : `${pathname}.js`;
  return pathToFileURL(join(DIST, file)).href;
};

Quark.moduleLoader = (url) => import(/* @vite-ignore */ moduleFile(url));

export const beforeRender = ({ url }: RenderPage) => resetRouter(url);

// `budgetMs` bounds the page; `whenSettled()` alone gives up after 1 s
export const settle = () => Quark.whenSettled({ timeout: Infinity });

/**
 * Canonical URL and `og:url` of a routed page. Fails a sitemap URL only the
 * fallback route matches (a soft 404), and a not-found path a route matches.
 */
export const afterRender = ({
  url,
  document,
}: RenderPage & { document: Document }) => {
  const notFound = !!document.querySelector(
    "spa-route[is-fallback][is-active]"
  );
  if (notFound !== (url === NOT_FOUND))
    throw new Error(
      notFound ? `${url} matches no route` : `${url} is not the fallback route`
    );
  if (notFound) return;
  const { origin, pathname } = new URL(url, document.location.href);
  const canonical = Object.assign(document.createElement("link"), {
    rel: "canonical",
    href: origin + pathname,
  });
  const ogUrl = document.createElement("meta");
  ogUrl.setAttribute("property", "og:url");
  ogUrl.setAttribute("content", origin + pathname);
  document.head.append(canonical, ogUrl);
};
