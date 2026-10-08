import type { PrerenderCache } from "./cache";
import { builtin, cwd, pathOf } from "./node";
import {
  type LocalPrerenderOptions,
  type PrerenderedPage,
  type PrerenderReport,
  prerenderWith,
} from "./prerender";

/**
 * What a config module of `runPrerender()` and the `nucleus-ssr` command
 * default-exports, or a function returns: the `prerender()` options. Its
 * relative `root`, `out` and `cache.dir` are the config file's folder's.
 * See `defineConfig()`.
 */
export type PrerenderConfig = LocalPrerenderOptions & {
  /**
   * True for URLs the site serves without a file of their own (a service
   * worker, a host rewrite): the link check skips them.
   */
  servedElsewhere?: (absoluteUrl: string) => boolean;
};

/** A config module's default export as a function: its options, or a promise of them. */
type ConfigFactory = () => PrerenderConfig | Promise<PrerenderConfig>;

/** The keys of what `F` returns that are no option: a misspelt `notfound`. */
type UnknownOptions<F extends ConfigFactory> = Exclude<
  keyof Awaited<ReturnType<F>>,
  keyof PrerenderConfig
>;

/**
 * Types a config module's default export: the options, or a function
 * returning them (a promise of them, when the routes come from a file or a
 * request). Returns it as given; a function keeps its own parameters. A key
 * that is no option (`notfound`) is a type error in either form.
 *
 * ```ts
 * // prerender.config.ts
 * export default defineConfig({
 *   root: "dist",
 *   origin: "https://example.com",
 *   entry: () => import("@excom/nucleus-kit/server"),
 *   routes: ["/", "/menu"],
 *   notFound: "/404",
 * });
 * ```
 */
export function defineConfig(config: PrerenderConfig): PrerenderConfig;
export function defineConfig<F extends ConfigFactory>(
  // a function returning an unknown key matches no function: the error names the key
  config: [UnknownOptions<F>] extends [never]
    ? F
    : () => { [K in UnknownOptions<F>]: never }
): F;
export function defineConfig(config: unknown): unknown {
  return config;
}

/** A config as loaded: `out` is `root` when it names none. */
export type LoadedPrerenderConfig = PrerenderConfig & { out: string | URL };

/** A mistake in what a run was given: the command prints its message alone, no stack. */
export class InputError extends Error {
  override name = "InputError";
}

/** Loads a module by absolute path. */
type Load = (file: string) => Promise<unknown>;

export interface RunOptions {
  /**
   * The config module, relative to `cwd` (see `PrerenderConfig`). Its
   * default export is the `prerender()` options with `routes`, or a function
   * returning them (`defineConfig()` types either). Relative `root`, `out`
   * and `cache.dir` in it are its own folder's, whatever the working
   * directory.
   */
  config: string;
  /**
   * Where `config` and `shellFile` are found.
   * @default the working directory
   */
  cwd?: string;
  /**
   * Loads `config` (an absolute path) in this process only. The default
   * worker imports it with Node: pass `worker` too when the workers need
   * another loader (one that resolves extensionless imports, say).
   * @default Node's `import()`
   */
  load?: Load;
  /**
   * The pool's worker module (path or `file:` URL), which calls
   * `serveRenderer()`.
   * @default the `nucleus-ssr` command, which loads `config` with Node's `import()`
   */
  worker?: string | URL;
  /**
   * Workers rendering at once.
   * @default one per core but one, at most 6
   */
  concurrency?: number;
  /**
   * The cache of this run; `false` drops the one the config names.
   * @default the config's `cache`
   */
  cache?: PrerenderCache | false;
  /**
   * Where to save the shell the pages rendered from (a fixed one), even when
   * a page failed: to serve it on routes never prerendered, or to compare a
   * cold render with.
   */
  shellFile?: string;
  /**
   * Takes each line of the report.
   * @default console.log
   */
  log?: (line: string) => void;
}

/** A page of a run, as its report line shows it. */
export interface RunPage extends PrerenderedPage {
  /** `shell`: a shell route, or it failed and `onError` sent it to the shell. `failed`: it failed, or its file is missing. */
  status: "ok" | "shell" | "failed";
  /** Its errors, or the missing file. */
  problems: string[];
  /** Reused, and rendered again to check the cache. */
  verified: boolean;
}

/** The link check of a run. */
export interface LinkCheck {
  /** Links to pages of the site that were checked. */
  checked: number;
  /** Each link to no page, once per page: the page's file, and the link as written. */
  broken: { page: string; href: string }[];
}

export interface RunReport {
  pages: RunPage[];
  /** None when nothing was written. */
  links?: LinkCheck;
  /** 1 when a page failed, a route has no file or a link leads to no page. */
  exitCode: 0 | 1;
}

/** Pages listed by size in the summary. */
const LARGEST = 3;

/** The config of a run, in the environment of each of its workers: an absolute path. */
export const CONFIG_ENV = "NUCLEUS_SSR_CONFIG";

/** One worker per core but one (the parent's), at most 6. */
export const defaultConcurrency = (): number =>
  Math.max(1, Math.min(builtin("node:os").availableParallelism() - 1, 6));

const importFile: Load = (file) =>
  import(/* @vite-ignore */ builtin("node:url").pathToFileURL(file).href);

/**
 * The `prerender()` options `file` default-exports (an object, or a
 * function returning one), its relative `root`, `out` and `cache.dir`
 * resolved against its folder, `out` being `root` when it names none: in
 * the parent and in every worker alike.
 */
export const loadPrerenderConfig = async (
  file: string,
  load: Load = importFile
): Promise<LoadedPrerenderConfig> => {
  const { dirname, isAbsolute, resolve } = builtin("node:path");
  const { default: config } = (await load(file)) as { default?: unknown };
  const options: PrerenderConfig = await (typeof config === "function"
    ? config()
    : config);
  if (!options?.routes)
    throw new InputError(`prerender: ${file} exports no options with routes`);
  const at = <T>(location: T) =>
    typeof location === "string" &&
    !location.startsWith("file:") &&
    !isAbsolute(location)
      ? resolve(dirname(file), location)
      : location;
  return {
    ...options,
    root: at(options.root),
    out: at(options.out ?? options.root),
    ...(options.cache && {
      cache: { ...options.cache, dir: at(options.cache.dir) },
    }),
  };
};

/** `onError` as a function of the page URL. */
const policyOf = ({ onError = "fail" }: Pick<PrerenderConfig, "onError">) =>
  typeof onError === "function" ? onError : () => onError;

/**
 * Each page's outcome: `ok`, `shell` (a shell route, or it failed and
 * `onError` sent it to the shell) or `failed` (it failed, or its file is
 * missing), and whether it was rendered again to verify the cache.
 * `written: false`: nothing was written (a page failed), so no file is
 * expected.
 */
export const classifyPages = (
  {
    pages,
    verified = [],
  }: Pick<PrerenderReport, "pages"> & { verified?: string[] },
  options: Pick<LoadedPrerenderConfig, "out" | "onError">,
  written = true
): RunPage[] => {
  const { existsSync } = builtin("node:fs");
  const policy = policyOf(options);
  const out = pathOf(options.out);
  return pages.map((page) => {
    const { errors } = page.diagnostics;
    const missing =
      written && !existsSync(builtin("node:path").join(out, page.file));
    // a shell route has no shell to fall back to: it is one
    const failed =
      (errors.length && (page.shellRoute || policy(page.url) !== "shell")) ||
      missing;
    return {
      ...page,
      verified: verified.includes(page.url),
      status: failed
        ? "failed"
        : errors.length || page.shellRoute
          ? "shell"
          : "ok",
      problems: errors.length
        ? errors
        : missing
          ? [`no file at ${page.file}`]
          : [],
    };
  });
};

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

/**
 * One line per page, its errors indented under it, then the summary:
 * counts (pages reused from the cache, and those of them rendered again to
 * verify it, shell routes), time, whether files were written, the largest
 * pages and islands, each distinct warning. A reused page's time is its
 * check's; a page the cache could not give says why.
 */
export const formatReport = (
  pages: RunPage[],
  ms: number,
  written = true
): string[] => {
  const width = Math.max(0, ...pages.map(({ file }) => file.length));
  const lines = pages.flatMap(
    ({
      file,
      bytes,
      ms: pageMs,
      status,
      problems,
      diagnostics,
      reused,
      verified,
      cacheMiss,
    }) => [
      [
        `  ${status.padEnd(6)} ${file.padEnd(width)}`,
        (bytes ? kB(bytes) : "-").padStart(10),
        `${pageMs} ms`.padStart(9),
        diagnostics.islandBytes ? ` island ${kB(diagnostics.islandBytes)}` : "",
        diagnostics.warnings.length
          ? ` ${diagnostics.warnings.length} warning(s)`
          : "",
        verified ? " verified" : reused ? " reused" : "",
        cacheMiss ? ` (cache: ${cacheMiss})` : "",
      ].join(""),
      ...(status === "ok"
        ? []
        : problems.map((problem) => `           ${problem}`)),
    ]
  );
  const count = (status: RunPage["status"]) =>
    pages.filter((page) => page.status === status).length;
  const reused = pages.filter((page) => page.reused).length;
  const shellRoutes = pages.filter(
    (page) => page.shellRoute && page.status === "shell"
  ).length;
  const largest = (size: (page: RunPage) => number) =>
    [...pages]
      .sort((a, b) => size(b) - size(a))
      .slice(0, LARGEST)
      .filter((page) => size(page))
      .map((page) => `${page.file} ${kB(size(page))}`)
      .join(", ");
  // each distinct warning with its count, in order of first appearance
  const warnings = pages
    .flatMap(({ diagnostics }) => diagnostics.warnings)
    .reduce(
      (counts, warning) => counts.set(warning, (counts.get(warning) ?? 0) + 1),
      new Map<string, number>()
    );
  return [
    ...lines,
    `prerender: ${count("ok") - reused} rendered, ${reused} reused (${pages.filter((page) => page.verified).length} verified), ${shellRoutes} shell route(s), ${count("shell") - shellRoutes} shell fallback(s), ${count("failed")} failed, in ${(ms / 1000).toFixed(1)} s${written ? "" : "; nothing written"}`,
    `  largest pages: ${largest(({ bytes }) => bytes)}`,
    `  largest islands: ${largest(({ diagnostics }) => diagnostics.islandBytes)}`,
    ...Array.from(
      warnings,
      ([warning, times]) => `  warning ×${times}: ${warning}`
    ),
  ];
};

/** Markup that is never part of the page: comments, scripts (the island too), styles. */
const UNRENDERED = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** A `<template>` start or end tag; quoted attribute values may hold `>`. */
const TEMPLATE_TAG =
  /<template\b((?:[^>"']|"[^"]*"|'[^']*')*)>|<\/template\s*>/gi;
/** A `<spa-a>` or `<a>` start tag, with its attributes. */
const LINK_TAG = /<(spa-a|a)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
/** A last path segment with a file extension: `.md`, `.txt`, `.xml`… */
const EXTENSION = /\.[^/.]+$/;
const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

/**
 * The markup a visitor gets: without `UNRENDERED` and without the content of
 * `<template>`s, which is inert (a declarative shadow root's is not).
 */
export const liveMarkup = (html: string): string => {
  const source = html.replace(UNRENDERED, "");
  // per open template: whether its content is inert
  const open: boolean[] = [];
  let live = "";
  let from = 0;
  for (const tag of source.matchAll(TEMPLATE_TAG)) {
    if (!open.includes(true)) live += source.slice(from, tag.index);
    if (tag[0][1] === "/") open.pop();
    else open.push(!/(?:^|\s)shadowrootmode\s*=/i.test(tag[1]!));
    from = tag.index + tag[0].length;
  }
  return open.includes(true) ? live : live + source.slice(from);
};

/** `&amp;`, `&quot;`, `&#39;`, `&#x41;`… decoded. */
const decodeEntities = (value: string) =>
  value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|quot|apos|lt|gt));/gi,
    (_, decimal, hex, name) =>
      name
        ? ENTITIES[name.toLowerCase()]!
        : String.fromCodePoint(decimal ? Number(decimal) : parseInt(hex, 16))
  );

/** An attribute's value from a start tag's attributes, entities decoded; `undefined` when absent. */
const attributeOf = (attributes: string, name: string) => {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
    "i"
  );
  const [, double, single, bare] = pattern.exec(attributes) ?? [];
  const value = double ?? single ?? bare;
  return value === undefined ? undefined : decodeEntities(value);
};

/** Every `.html` file under `dir`, as `/`-separated paths relative to it. */
const htmlFiles = (dir: string) =>
  new Set(
    builtin("node:fs")
      .readdirSync(dir, { recursive: true })
      .map((file) => String(file).replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".html"))
  );

/** Whether a path has a page: `/` → `index.html`, `/a/b` and `/a/b/` → `a/b.html` or `a/b/index.html`. */
const hasPage = (files: Set<string>, pathname: string) => {
  const route = pathname.replace(/^\/+|\/+$/g, "");
  return route
    ? files.has(`${route}.html`) || files.has(`${route}/index.html`)
    : files.has("index.html");
};

const decodePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

/**
 * Broken internal links: each `<a href>` and `<spa-a route-href>` of the
 * written pages that leads to a page of the site with no file in `out`
 * (`/a/b` needs `a/b.html` or `a/b/index.html`). Links resolve against
 * their page's URL on `origin`; query and fragment are ignored. Comments,
 * scripts, styles and inert `<template>` content are skipped, as are paths
 * with a file extension, other origins, URLs `servedElsewhere` accepts and
 * pages with no file. Each broken link is listed once per page, as written.
 * Node only.
 */
export function checkLinks(
  pages: readonly { url: string; file: string }[],
  {
    out,
    origin,
    servedElsewhere = () => false,
  }: {
    /** Where the pages were written (path or `file:` URL). */
    out: string | URL;
    /** The production origin pages render under. */
    origin: string;
    /** True for URLs the site serves without a file of their own: a service worker, a host rewrite. */
    servedElsewhere?: (absoluteUrl: string) => boolean;
  }
): LinkCheck {
  const { existsSync, readFileSync } = builtin("node:fs");
  const outPath = pathOf(out);
  const files = htmlFiles(outPath);
  const site = new URL(origin).origin;
  let checked = 0;
  const broken: LinkCheck["broken"] = [];
  for (const { url, file } of pages) {
    const target = builtin("node:path").join(outPath, file);
    if (!existsSync(target)) continue;
    const base = new URL(url, site);
    const listed = new Set<string>();
    for (const [, tag, attributes] of liveMarkup(
      readFileSync(target, "utf8")
    ).matchAll(LINK_TAG)) {
      const href = attributeOf(
        attributes!,
        tag!.toLowerCase() === "a" ? "href" : "route-href"
      );
      if (href === undefined || !URL.canParse(href, base)) continue;
      const link = new URL(href, base);
      const pathname = decodePath(link.pathname);
      if (
        link.origin !== site ||
        EXTENSION.test(pathname) ||
        servedElsewhere(link.href)
      )
        continue;
      checked += 1;
      if (hasPage(files, pathname) || listed.has(href)) continue;
      listed.add(href);
      broken.push({ page: file, href });
    }
  }
  return { checked, broken };
}

/** The link check's lines: the count, then each link to no file under the page that has it. */
export const formatLinks = ({ checked, broken }: LinkCheck): string[] =>
  broken.length
    ? [
        `  links: ${checked} checked, ${broken.length} to no page:`,
        ...broken.map(({ page, href }) => `    ${page} → ${href}`),
      ]
    : [`  links: ${checked} checked, each to a page`];

/**
 * A sitemap's URLs as `routes`: `<loc>https://example.com/menu</loc>` →
 * `/menu`, so every page search engines are told of is prerendered.
 * Entities and CDATA are read, each path is listed once, queries stay.
 * Throws when it lists none, or one not on `origin`, or when it is a
 * sitemap index.
 */
export const sitemapRoutes = (xml: string, origin: string): string[] => {
  if (/<([\w.-]+:)?sitemapindex\b/.test(xml))
    throw new Error(
      "prerender: the sitemap is a sitemap index: it lists sitemaps, not pages; pass one of its sitemaps"
    );
  // the `<loc>`s of the sitemap's own namespace: not `<image:loc>`
  const prefix = (/<([\w.-]+:)?urlset\b/.exec(xml)?.[1] ?? "").replaceAll(
    ".",
    "\\."
  );
  const loc = new RegExp(
    `<${prefix}loc(?:\\s[^>]*)?>([\\s\\S]*?)</${prefix}loc\\s*>`,
    "g"
  );
  const urls = Array.from(xml.matchAll(loc), ([, text]) => {
    const value = text!.trim();
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(value);
    return cdata ? cdata[1]!.trim() : decodeEntities(value);
  });
  if (!urls.length) throw new Error("prerender: the sitemap lists no URL");
  const site = origin.replace(/\/+$/, "");
  return [
    ...new Set(
      urls.map((url) => {
        if (url !== site && !url.startsWith(`${site}/`))
          throw new Error(`prerender: ${url} is not on ${origin}`);
        return url.slice(site.length) || "/";
      })
    ),
  ];
};

/**
 * Prerenders a built site from a config module, as the `nucleus-ssr`
 * command does: every route in a pool of worker processes, then a line per
 * page and a summary, then the links of the written pages (`checkLinks`).
 * `exitCode` is 1 when a page failed, a route has no file or a link leads
 * to no page; a page `onError` sends to the shell is no failure. Rejects
 * when the run cannot go on (see `prerender()`). Node only.
 *
 * ```js
 * const { exitCode } = await runPrerender({ config: "prerender.config.js" });
 * ```
 */
export async function runPrerender({
  config,
  cwd: base = cwd(),
  load = importFile,
  worker,
  concurrency = defaultConcurrency(),
  cache,
  shellFile,
  log = console.log,
}: RunOptions): Promise<RunReport> {
  if (!config)
    throw new InputError(
      "prerender: pass the config module, e.g. prerender.config.js"
    );
  const { existsSync, mkdirSync, readFileSync, writeFileSync } =
    builtin("node:fs");
  const { dirname, join, resolve } = builtin("node:path");
  const file = resolve(base, config);
  const { servedElsewhere, ...options } = await loadPrerenderConfig(file, load);
  const shellPath = join(pathOf(options.root), "index.html");
  if (options.shell === undefined && !existsSync(shellPath))
    throw new InputError(
      `prerender: no shell at ${shellPath}: build the site first, or fix root in ${file}`
    );
  // read before the run writes `/` over it
  const shell =
    typeof options.shell === "function"
      ? undefined
      : (options.shell ?? readFileSync(shellPath, "utf8"));
  const started = performance.now();
  let written = true;
  // a page failure rejects once every route ran, writing nothing, with the report
  const report = await prerenderWith(
    {
      routes: options.routes,
      shellRoutes: options.shellRoutes,
      out: options.out,
      notFound: options.notFound,
      // the command, one level up from `src/` and from `dist/` alike
      worker:
        worker ??
        join(
          dirname(builtin("node:url").fileURLToPath(import.meta.url)),
          "../nucleus-ssr.mjs"
        ),
      concurrency,
      cache: cache === false ? undefined : (cache ?? options.cache),
    },
    // each worker's own: runs at once in one process keep their configs
    { [CONFIG_ENV]: file }
  ).catch((error) => {
    if (!error?.report) throw error;
    written = false;
    return error.report as PrerenderReport;
  });
  if (shellFile !== undefined) {
    if (shell === undefined)
      log(
        "prerender: no shell saved: the config's shell is a function, each route may have its own"
      );
    else {
      const target = resolve(base, shellFile);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, shell);
    }
  }
  const pages = classifyPages(report, options, written);
  formatReport(pages, performance.now() - started, written).forEach((line) =>
    log(line)
  );
  const links = written
    ? checkLinks(pages, { ...options, servedElsewhere })
    : undefined;
  if (links) formatLinks(links).forEach((line) => log(line));
  const failed =
    pages.some(({ status }) => status === "failed") || !!links?.broken.length;
  return { pages, links, exitCode: failed ? 1 : 0 };
}
