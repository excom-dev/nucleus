/**
 * The site in the prerenderer's window: Nucleus Kit's server entry (its
 * elements, and the hooks run around each page), Quark `@use` modules from
 * `dist`, and the site's own `afterRender`.
 */
import { DIST } from "./prerender.config";
import {
  SITE_BASE,
  SITE_HOME,
  SITE_HOME_DOC,
} from "@excom/heft-rig/scripts/site-base.mjs";
import { afterRender as checkRoute } from "@excom/nucleus-kit/server";
import type { RenderPage } from "@excom/nucleus-ssr";
import { Quark } from "@excom/quark";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export * from "@excom/nucleus-kit/server";

/** The built file a `@use` URL serves: an extensionless one is `<path>.js` (`_redirects`). */
export const moduleFile = (url: string): string => {
  const { origin, pathname } = new URL(url, location.origin);
  if (origin !== location.origin)
    throw new Error(`${url} is not a module of this site`);
  const file = /\.[^/]+$/.test(pathname) ? pathname : `${pathname}.js`;
  return pathToFileURL(join(DIST, file)).href;
};

Quark.moduleLoader = (url) => import(/* @vite-ignore */ moduleFile(url));

const GUIDE = new RegExp(`^${SITE_BASE}/docs/([^/]+)$`);
const PACKAGE = new RegExp(`^${SITE_BASE}/packages/([^/]+)$`);

/**
 * The site path of a page's markdown file: a guide's is `/docs/<name>.md`
 * (the docs home is the Introduction), a package's page `/<package>.md`.
 * Undefined for any other page. It maps the route only: a package may have
 * no file, so `afterRender` asks for it.
 */
export const markdownHref = (pathname: string): string | undefined => {
  const guide =
    pathname === SITE_HOME ? SITE_HOME_DOC : GUIDE.exec(pathname)?.[1];
  const pkg = PACKAGE.exec(pathname)?.[1];
  return guide ? `/docs/${guide}.md` : pkg && `/${pkg}.md`;
};

/** Adds the alternate link to `markdown` when a HEAD request for it is ok; an error is no answer. */
const linkMarkdown = async (
  window: RenderPage["window"],
  document: Document,
  origin: string,
  markdown: string
) => {
  const answer = await window
    .fetch(markdown, { method: "HEAD" })
    .catch(() => undefined);
  if (answer?.ok)
    document.head.append(
      Object.assign(document.createElement("link"), {
        rel: "alternate",
        type: "text/markdown",
        href: origin + markdown,
        title: "Markdown version of this page",
      })
    );
};

/**
 * Canonical URL and `og:url` of a routed page, and, once the page's own
 * window has asked and the file answers, a link to its markdown. The request
 * is the page's own so the prerender cache sees it: a file that appears or
 * goes is a changed page. The kit's check runs first: it fails a sitemap
 * URL only the fallback route matches (a soft 404), and a not-found path a
 * route matches. The not-found page gets none of these.
 */
export const afterRender = (page: RenderPage & { document: Document }) => {
  checkRoute(page);
  if (page.notFound) return;
  const { url, window, document } = page;
  const { origin, pathname } = new URL(url, document.location.href);
  const canonical = Object.assign(document.createElement("link"), {
    rel: "canonical",
    href: origin + pathname,
  });
  const ogUrl = document.createElement("meta");
  ogUrl.setAttribute("property", "og:url");
  ogUrl.setAttribute("content", origin + pathname);
  document.head.append(canonical, ogUrl);
  const markdown = markdownHref(pathname);
  return markdown
    ? linkMarkdown(window, document, origin, markdown)
    : undefined;
};
