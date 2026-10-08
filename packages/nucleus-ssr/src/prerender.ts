import {
  type CachedPage,
  discardCache,
  missOf,
  pick,
  type PrerenderCache,
  readCache,
  runKey,
  writeCache,
} from "./cache";
import type { Diagnostics } from "./diagnostics";
import { builtin, pathOf } from "./node";
import { openRenderers, type Renderers } from "./pool";
import type { RendererOptions } from "./renderer";
import type { Outcome } from "./worker";
import { sameTree } from "@excom/nucleus-dom";

/** What every prerender takes: the routes, where they go, the cache. */
interface PrerenderTargets {
  /** Paths to render, each to `<out>/<path>.html` (`/` → `index.html`, `/a/b` → `a/b.html`). */
  routes: readonly string[];
  /**
   * Output directory (path or `file:` URL); may be `root`: files are written
   * once every page rendered.
   * @default `root`
   */
  out?: string | URL;
  /**
   * Paths written as the untouched shell, not rendered, to the files
   * `routes` would write: pages that depend on the person (a bag, an
   * account) and render in the browser. Never cached. A path also in
   * `routes`, or `notFound`, is refused.
   */
  shellRoutes?: readonly string[];
  /**
   * Path of the not-found page, rendered last to `404.html`. Its hooks get
   * `page.notFound`, so the app's entry need not know the path. A path
   * also in `routes` is refused: a page is one or the other.
   */
  notFound?: string;
  /**
   * Pages whose inputs did not change since the last run are written from
   * here instead of rendered again: incremental builds, e.g. in CI with the
   * directory in the CI's cache. A page is reused when the key is the same
   * and its shell and every request it made answer as they did (status and
   * body). Data a module fetches when it is evaluated is recorded only by
   * the first page that loads it: cover it with `cache.key`. Written once a
   * run wrote its pages, with the pages that rendered without errors.
   */
  cache?: PrerenderCache;
}

/** Renders in this process, one page at a time, with the renderer options. */
export interface LocalPrerenderOptions
  extends RendererOptions, PrerenderTargets {
  worker?: undefined;
  concurrency?: undefined;
}

/**
 * Renders in a pool of worker processes, each with a renderer of its own:
 * faster on a machine with several cores. The renderer options are the
 * worker module's (`serveRenderer()`): none crosses processes.
 */
export interface PooledPrerenderOptions
  extends PrerenderTargets, Partial<Record<keyof RendererOptions, never>> {
  /** The worker module (path or `file:` URL), which calls `serveRenderer()`. */
  worker: string | URL;
  /** Output directory (path or `file:` URL). No default: `root` is the worker's. */
  out: string | URL;
  /**
   * Workers rendering at once. A page that never yields is stopped at twice
   * `budgetMs` and fails; its worker is replaced.
   * @default 1
   */
  concurrency?: number;
}

export type PrerenderOptions = LocalPrerenderOptions | PooledPrerenderOptions;

export interface PrerenderedPage {
  url: string;
  /** Path under `out`. Not written when the page failed under the `"fail"` policy. */
  file: string;
  /** Size of the HTML; `0` when the page has none to write. */
  bytes: number;
  /** Time to render it, or to check its cached copy. */
  ms: number;
  diagnostics: Diagnostics;
  /** Written from the cache: its inputs did not change. */
  reused: boolean;
  /**
   * Why a run with a `cache` rendered it: `no cache found`, `the cache key
   * changed`, `GET /data/menu.json answered another body`, …
   */
  cacheMiss?: string;
  /** One of `shellRoutes`: written as the untouched shell. */
  shellRoute?: true;
}

export interface PrerenderReport {
  pages: PrerenderedPage[];
  /** URLs of the pages with errors, written with their shell or not at all. */
  failed: string[];
  /** URLs of reused pages rendered again to check the cache (`cache.verify`). */
  verified: string[];
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

/**
 * Each URL's page, then closes `renderers`: reused from `cached` when its
 * shell and requests answer as before, else rendered (`changed` says what
 * answered otherwise); `verify` of the
 * reused ones, picked at random, rendered all the same. One of those that
 * differs from its cached copy (`sameTree`: attribute order aside) renders
 * once more: `unstable` when the two renders differ too. Each of `shells` is
 * its untouched shell, `notFound` rendered as the not-found page.
 */
const renderAll = async (
  renderers: Renderers,
  urls: string[],
  shells: string[],
  cached: Record<string, CachedPage>,
  verify: number,
  notFound?: string
) => {
  try {
    const checks = new Map(
      await Promise.all(
        urls
          .filter((url) => cached[url])
          .map(async (url) => {
            const { shell, diagnostics } = cached[url]!;
            const check = await renderers.changed(url, {
              shell,
              requests: diagnostics.requests,
            });
            return [url, check] as const;
          })
      )
    );
    const reused = new Set(
      Array.from(checks)
        .filter(([, { changed }]) => !changed)
        .map(([url]) => url)
    );
    const verified = pick([...reused], verify);
    const pages = new Map<string, Outcome & { ms: number }>(
      await Promise.all([
        ...urls.map(
          async (url) =>
            [
              url,
              reused.has(url) && !verified.has(url)
                ? { ...cached[url]!, ms: checks.get(url)!.ms }
                : await renderers.render(url, url === notFound),
            ] as const
        ),
        ...shells.map(
          async (url) => [url, await renderers.shell(url)] as const
        ),
      ])
    );
    // a page that fails now is a failure, not a difference
    const differing = [...verified].filter((url) => {
      const { html, diagnostics } = pages.get(url)!;
      return !diagnostics.errors.length && !sameTree(html!, cached[url]!.html);
    });
    const again = await Promise.all(
      differing.map((url) => renderers.render(url, url === notFound))
    );
    const unstable = differing.filter(
      (url, index) =>
        again[index]!.html === undefined ||
        !sameTree(again[index]!.html!, pages.get(url)!.html!)
    );
    const changed = new Map(
      Array.from(checks, ([url, check]) => [url, check.changed])
    );
    return { pages, reused, verified, differing, unstable, changed };
  } finally {
    await renderers.close();
  }
};

/**
 * Prerenders (static site generation, SSG) every route of a built site,
 * then writes each to `<out>/<route>.html` (see `routeFile`), each of
 * `shellRoutes` as its untouched shell, and `notFound` to `404.html`, so a
 * static host can serve every URL as HTML that hydrates. In this process
 * with one renderer (`createRenderer`), or in a pool of workers (`worker`,
 * `concurrency`); with a `cache`, pages whose
 * inputs did not change are not rendered again. Files are written once
 * every page has rendered, so no page reads another's output; routes that
 * would share a file (`/a` and `/A`, `/a?x` and `/a?y`) are refused first,
 * as is a `notFound` path that is a route too.
 * Rejects (`error.report`), writing nothing, if a page failed under the
 * `"fail"` policy; rejects writing nothing, whatever the policy, if the
 * shell is a page an earlier prerender wrote, or one a browser parses
 * differently, or if a page checked against the cache differs. Node only.
 */
export function prerender(options: PrerenderOptions): Promise<PrerenderReport> {
  return prerenderWith(options);
}

/** `prerender()`, its workers started with `env` added to their environment: one run's, not the process's. */
export async function prerenderWith(
  {
    routes,
    shellRoutes = [],
    out,
    notFound,
    cache,
    worker,
    concurrency = 1,
    ...options
  }: PrerenderOptions,
  env: Record<string, string> = {}
): Promise<PrerenderReport> {
  const { mkdirSync, writeFileSync } = builtin("node:fs");
  const { dirname, join } = builtin("node:path");
  const destination = out ?? (options as Partial<RendererOptions>).root;
  if (destination === undefined)
    throw new TypeError(
      "nucleus-ssr: out is missing: with a worker it has no default (root is the worker's)"
    );
  const outPath = pathOf(destination);
  const both = shellRoutes.filter((url) => [...routes, notFound].includes(url));
  if (both.length)
    throw new TypeError(
      `nucleus-ssr: shell routes also rendered (routes, notFound): ${both.join(", ")}`
    );
  // it would render once, as the not-found page, for both files
  if (notFound !== undefined && routes.includes(notFound))
    throw new TypeError(
      `nucleus-ssr: the not-found page is also a route (routes, notFound): ${notFound}`
    );
  const targets = [
    ...[...routes, ...shellRoutes].map((url) => [url, routeFile(url)]),
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
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new TypeError(
      `nucleus-ssr: concurrency must be a whole number above 0, not ${concurrency}`
    );
  const shells = new Set(shellRoutes);
  const urls = [
    ...new Set(targets.map(([url]) => url).filter((url) => !shells.has(url))),
  ];
  const renderers = await openRenderers(
    worker === undefined
      ? { options: options as RendererOptions }
      : {
          worker: pathOf(worker),
          size: Math.min(concurrency, Math.max(1, urls.length + shells.size)),
          env,
        }
  );
  const key = cache ? runKey(cache, renderers.key, notFound) : "";
  const stored = cache && readCache(cache);
  const cached = stored?.key === key ? stored.pages : {};
  const { pages, reused, verified, differing, unstable, changed } =
    await renderAll(
      renderers,
      urls,
      [...shells],
      cached,
      cache?.verify ?? 2,
      notFound
    );
  if (unstable.length)
    throw new Error(
      `nucleus-ssr: ${unstable.join(", ")} rendered other HTML each time: its output is not deterministic (ids, the clock, the order requests complete in), so no cache can hold it`
    );
  if (differing.length) {
    discardCache(cache!);
    throw new Error(
      `nucleus-ssr: ${differing.join(", ")} rendered other HTML than cached from the same shell and requests: the cache key misses an input. The cache is discarded`
    );
  }
  const clean = (url: string) => !pages.get(url)!.diagnostics.errors.length;
  const written = targets.map(([url, file]): PrerenderedPage => {
    const { html, diagnostics, ms } = pages.get(url)!;
    const shellRoute = shells.has(url);
    const kept = reused.has(url) && clean(url);
    const cacheMiss =
      kept || shellRoute || !cache
        ? undefined
        : verified.has(url)
          ? "rendered again to verify the cache"
          : (changed.get(url) ?? missOf(stored, key, url));
    return {
      url,
      file,
      bytes: new TextEncoder().encode(html ?? "").byteLength,
      ms,
      diagnostics,
      reused: kept,
      ...(cacheMiss && { cacheMiss }),
      ...(shellRoute && { shellRoute }),
    };
  });
  const report: PrerenderReport = {
    pages: written,
    failed: written.filter(({ url }) => !clean(url)).map(({ url }) => url),
    verified: urls.filter((url) => verified.has(url) && clean(url)),
  };
  const refused = written.filter(
    ({ url }) => pages.get(url)!.html === undefined
  );
  if (refused.length)
    throw Object.assign(
      new Error(
        `nucleus-ssr: ${refused.length} of ${written.length} pages failed: ${refused.map(({ url }) => url).join(", ")}`
      ),
      { report }
    );
  for (const [url, file] of targets) {
    const target = join(outPath, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, pages.get(url)!.html!);
  }
  if (cache)
    writeCache(cache, {
      key,
      pages: Object.fromEntries(
        urls.filter(clean).map((url) => {
          const { html, diagnostics, shell } = pages.get(url)!;
          return [url, { html: html!, diagnostics, shell: shell! }];
        })
      ),
      failed: report.failed,
    });
  return report;
}
