import type { Diagnostics } from "./diagnostics";
import { builtin, pathOf } from "./node";
import {
  createRenderer,
  type RendererOptions,
  type RenderResult,
} from "./renderer";

export interface PrerenderOptions extends RendererOptions {
  /** Paths to render, each to `<out>/<path>.html` (`/` → `index.html`, `/a/b` → `a/b.html`). */
  routes: readonly string[];
  /** Output directory (path or `file:` URL); may be `root`: files are written once every page rendered. */
  out: string | URL;
  /** Path of the not-found page, rendered last to `404.html`. */
  notFound?: string;
}

export interface PrerenderedPage {
  url: string;
  /** Path under `out`. Not written when the page failed under the `"fail"` policy. */
  file: string;
  /** Size of the HTML; `0` when the page has none to write. */
  bytes: number;
  ms: number;
  diagnostics: Diagnostics;
}

export interface PrerenderReport {
  pages: PrerenderedPage[];
  /** URLs of the pages with errors, written with their shell or not at all. */
  failed: string[];
}

/**
 * The file a route renders to. Files are slashless: `/` → `index.html`;
 * `/a/b` and `/a/b/` → `a/b.html`; `/a.html` stays `a.html`. The host must
 * serve `/a/b` from `a/b.html` (many static hosts do, some need a rewrite
 * rule). Query and hash are ignored. A route whose file could land outside
 * the output (`..`, `\`, `:`) is refused.
 */
export const routeFile = (route: string): string => {
  const path = decodeURIComponent(
    new URL(route, "http://route.invalid").pathname
  ).replace(/^\/+|\/+$/g, "");
  if (/[\\:\0]/.test(path) || path.split("/").includes(".."))
    throw new TypeError(
      `nucleus-ssr: route ${route} has no file in the output`
    );
  const file = path || "index";
  return /\.html$/i.test(file) ? file : `${file}.html`;
};

/** A render's result; a page failure (`error.diagnostics`) as diagnostics without HTML. */
const outcome = async (
  rendering: Promise<RenderResult>
): Promise<{ html?: string; diagnostics: Diagnostics }> => {
  try {
    return await rendering;
  } catch (error) {
    const { diagnostics } = error as { diagnostics?: Diagnostics };
    if (!diagnostics) throw error;
    return { diagnostics };
  }
};

/**
 * Prerenders (static site generation, SSG) every route of a built site:
 * one renderer (`createRenderer`), pages in order, then each written to
 * `<out>/<route>.html` (see `routeFile`) and `notFound` to `404.html`, so a
 * static host can serve every URL as HTML that hydrates. Files are written
 * once every page has rendered, so no page reads another's output; routes
 * that would share a file (`/a` and `/A`, `/a?x` and `/a?y`) are refused
 * first. Rejects (`error.report`), writing nothing, if a page failed under
 * the `"fail"` policy; rejects writing nothing, whatever the policy, if the
 * shell is a page an earlier prerender wrote, or one a browser parses
 * differently. Node only.
 */
export async function prerender({
  routes,
  out,
  notFound,
  ...options
}: PrerenderOptions): Promise<PrerenderReport> {
  const { mkdirSync, writeFileSync } = builtin("node:fs");
  const { dirname, join } = builtin("node:path");
  const outPath = pathOf(out);
  const targets = [
    ...routes.map((url) => [url, routeFile(url)]),
    ...(notFound === undefined ? [] : [[notFound, "404.html"]]),
  ];
  // case-folded: macOS and Windows file systems ignore case
  const claims = new Map<string, string>();
  for (const [url, file] of targets) {
    const other = claims.get(file.toLowerCase());
    if (other !== undefined)
      throw new TypeError(
        `nucleus-ssr: routes ${other} and ${url} would both write ${file}`
      );
    claims.set(file.toLowerCase(), url);
  }
  const renderer = await createRenderer(options);
  const pages: PrerenderedPage[] = [];
  // by file; none for a page that failed under the "fail" policy
  const output = new Map<string, string | undefined>();
  try {
    for (const [url, file] of targets) {
      const started = Date.now();
      const { html, diagnostics } = await outcome(renderer.render(url));
      output.set(file, html);
      pages.push({
        url,
        file,
        bytes: new TextEncoder().encode(html ?? "").byteLength,
        ms: Date.now() - started,
        diagnostics,
      });
    }
  } finally {
    await renderer.close();
  }
  const report = {
    pages,
    failed: pages
      .filter(({ diagnostics }) => diagnostics.errors.length)
      .map(({ url }) => url),
  };
  const refused = pages.filter(({ file }) => output.get(file) === undefined);
  if (refused.length)
    throw Object.assign(
      new Error(
        `nucleus-ssr: ${refused.length} of ${pages.length} pages failed: ${refused.map(({ url }) => url).join(", ")}`
      ),
      { report }
    );
  for (const [file, html] of output) {
    const target = join(outPath, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html!);
  }
  return report;
}
