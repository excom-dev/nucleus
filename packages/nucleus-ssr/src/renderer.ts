import {
  captureConsole,
  describe,
  describeParseDifference,
  type Diagnostics,
  emptyDiagnostics,
  notReady,
  readVirtualConsole,
  watchErrorEvents,
} from "./diagnostics";
import { inertDom } from "./inert";
import { builtin, cwd, EXPIRED, pathOf, within } from "./node";
import { type IslandNames, serialize } from "./serialize";
import type { ServerRender } from "@excom/kit-utils";
import {
  type ApiHandler,
  createDom,
  type CreateDomOptions,
  type DomWindow,
  findParseDifference,
  installGlobals,
  type ParseDifference,
  type PendingWork,
  resetDocument,
  serve,
  whenIdle,
} from "@excom/nucleus-dom";

/** What a page with errors gives: a rejection, or the untouched shell. */
export type ErrorPolicy = "fail" | "shell";

/** The page a hook runs for. `url`: its path, query and hash (`location.href` has the whole URL). */
export interface RenderPage {
  url: string;
  window: DomWindow;
}

/** App code the renderer calls around each page: return them from `entry`. */
export interface RendererHooks {
  /** Once the previous page is gone, before this one parses: reset module-level state, e.g. `resetRouter(url)`. */
  beforeRender?(page: RenderPage): unknown;
  /**
   * Resolves once the app is quiet; a page settles when this and the window
   * are quiet together. Quark: `() => Quark.whenSettled({ timeout: Infinity })`,
   * since `whenSettled()` gives up after its own 1 s (when timers that long
   * fire, `holdTimersAbove` ≥ 1000) and `budgetMs` already bounds the page.
   */
  settle?(): unknown;
  /** After the page settled, before it is serialized: per-page `<link rel="canonical">` or `<meta name="description">`. */
  afterRender?(page: RenderPage & { document: Document }): unknown;
}

export interface RendererOptions {
  /** The built site (path or `file:` URL), served at `origin`. */
  root: string | URL;
  /** Production origin pages render under: `"https://example.com"`. */
  origin: string;
  /**
   * Loads and defines the app's elements, after the window's globals are
   * installed: `() => import("./prerender-entry.js")`. The `beforeRender`,
   * `settle` and `afterRender` functions of what it resolves to are the
   * hooks; its `SERVER_EXCLUDED_TAGS` (`export * from
   * "@excom/nucleus-kit/server"`) join `excludedTags`. Modules evaluate once
   * per process: a process gets one renderer per entry (a later one would
   * define nothing, and is refused).
   */
  entry: () => Promise<unknown>;
  /**
   * Page HTML for a URL (its path). Its doctype, or the lack of one, is kept.
   * A page an earlier prerender wrote (`<html n-ssr>`) is no shell, nor is
   * one a browser parses into other elements than the renderer (a block
   * element inside `<p>`): whatever `onError` says, `createRenderer` rejects
   * for a fixed one and `render()` for one a function gives, without
   * diagnostics. Rebuild the site first, or fix the markup.
   * @default `<root>/index.html`, read once before any page renders
   */
  shell?: string | ((url: string) => string | Promise<string>);
  /**
   * File under `root` for an extensionless path with no file of its own,
   * e.g. `"index.html"`. As the SPA fallback a host serves, it must parse in
   * a browser as in the renderer: `createRenderer` rejects for it as for a
   * shell (see `shell`).
   */
  fallback?: string;
  /**
   * Answers same-origin `/api/*` GET / HEAD requests: a mock backend. Writes
   * are refused. A private response (`Cache-Control: private` / `no-store`,
   * `Vary` on `Cookie` / `Authorization` / `Accept-Language` / `*`) fails
   * the page: a public page must not be built from it. `Set-Cookie` counts
   * only where the headers keep it: while a renderer is open the global
   * `Response` is happy-dom's, which drops it, so mark such responses with
   * one of those.
   */
  api?: ApiHandler;
  /**
   * Viewport size, for `matchMedia()` and `innerWidth`.
   * @default { width: 1024, height: 768 }
   */
  viewport?: CreateDomOptions["viewport"];
  /**
   * Timers longer than this (ms) never fire: a 3 s `@delay` neither delays
   * a page nor shows in it.
   * @default 100
   */
  holdTimersAbove?: number;
  /**
   * Time (ms) a page may take to settle. It cannot stop code that never
   * yields to the event loop.
   * @default 5000
   */
  budgetMs?: number;
  /**
   * Responses kept out of the island, by ABSOLUTE URL (every other option
   * takes a path): e.g. ones a service worker answers from client state,
   * `(absoluteUrl) => new URL(absoluteUrl).pathname.startsWith("/api/")`.
   * An element whose data came from one is written not loaded (no
   * `is-success` / `did-load`) with its rendered content in place; in the
   * browser it fetches as on a cold load, and rules keyed on its loaded
   * state match once that data arrives. Never shipped, but still fetched:
   * for private data, mark the response (see `api`; a `Set-Cookie` alone
   * goes unseen).
   */
  exclude?: (absoluteUrl: string) => boolean;
  /**
   * Custom element tags that must not be defined in the renderer once
   * `entry` loaded: elements that read the device or the person.
   */
  excludedTags?: readonly string[];
  /**
   * A page with errors: `"fail"` rejects with them (`error.diagnostics`),
   * `"shell"` resolves to the untouched shell. Per route as a function of
   * the path: client-only routes fall back to the shell, the rest fail. A
   * `shell` function that throws has no shell to give: the page fails. A
   * prerendered shell, or one a browser parses differently, fails the run
   * (see `shell`).
   * @default "fail"
   */
  onError?: ErrorPolicy | ((url: string) => ErrorPolicy);
  /** Island size (bytes) above which a page gets a warning. */
  warnIslandBytes?: number;
}

export interface RenderResult {
  html: string;
  diagnostics: Diagnostics;
}

export interface Renderer {
  /**
   * Renders one page (path or same-origin URL). Pages render one at a time,
   * in call order. A failed page rejects with `error.diagnostics` (`"fail"`);
   * an error without them (a prerendered shell) means the run cannot go on.
   */
  render(url: string): Promise<RenderResult>;
  /** The one window every page renders in. */
  readonly window: DomWindow;
  /** Restores the globals and closes the window. */
  close(): Promise<void>;
}

type RequestContext = { request: Request; window: DomWindow };
type Interceptor = Record<string, unknown> & {
  beforeAsyncRequest(context: RequestContext): Promise<Response | undefined>;
  beforeSyncRequest(context: RequestContext): unknown;
};

/** A page's diagnostics. */
const idlePage = () => ({ diagnostics: emptyDiagnostics() });

const HOOKS = ["beforeRender", "settle", "afterRender"] as const;
const SAFE_METHODS = ["GET", "HEAD"];
const OPEN = Symbol.for("@excom/nucleus-ssr:open");
// where `createDom()` keeps a window's tracked work
const ACTIVITY = Symbol.for("@excom/nucleus-dom/activity");
// what a render loads: a `file:` URL reads the build machine's disk
const WEB = /^https?:$/;

/** `url` short enough for a diagnostic: a `data:` URL holds a whole resource. */
const clip = (url: string) =>
  url.length > 120 ? `${url.slice(0, 120)}…` : url;

/** Why a response varies per person, if it does: a public page must not be built from it. */
const privacyOf = (headers: Headers) => {
  const cache = headers.get("cache-control") ?? "";
  const vary = headers.get("vary") ?? "";
  return headers.has("set-cookie")
    ? "Set-Cookie"
    : /private|no-store/i.test(cache)
      ? `Cache-Control: ${cache}`
      : /\*|cookie|authorization|accept-language/i.test(vary)
        ? `Vary: ${vary}`
        : undefined;
};

/** A shell no page may be built from: the run fails, whatever the policy. */
class ShellError extends Error {}

/**
 * A shell an earlier prerender wrote (`<html n-ssr>`): its content, ids and
 * island are stale, and under the `"shell"` policy it would be written back
 * as every page.
 */
const staleShell = ({ SSR_ATTR }: IslandNames) =>
  new ShellError(
    `nucleus-ssr: the shell was written by an earlier prerender (<html ${SSR_ATTR}>): rebuild the site, then prerender from its built shell`
  );

/**
 * A shell a browser parses into other elements than the renderer: no page
 * built from it hydrates as rendered, and under the `"shell"` policy it
 * would be written as is. `source` names which one, as `route /menu` or
 * `fallback index.html`, when there can be more than one.
 */
const misparsedShell = (difference: ParseDifference, source?: string) =>
  new ShellError(
    `nucleus-ssr: the shell parses differently in a browser${source ? ` (${source})` : ""}: ${describeParseDifference(difference)}`
  );

/**
 * `use`'s result for `html` parsed in `window`, which then lets go of the
 * document: happy-dom's window keeps the first element of each id it
 * parsed, and with it the whole page.
 */
const parsedIn = <T>(
  window: DomWindow,
  html: string,
  use: (document: Document) => T
): T => {
  const document = new window.DOMParser().parseFromString(html, "text/html");
  try {
    return use(document);
  } finally {
    document.documentElement.remove();
  }
};

/** The text of the file at `path`, or `undefined` when there is none. */
const readText = (path: string) => {
  try {
    return builtin("node:fs").readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** The shell's own doctype (after leading space and comments), or `""`. */
const doctypeOf = (html: string) =>
  /^(?:\s|<!--[\s\S]*?-->)*(<!doctype[^>]*>)/i.exec(html)?.[1] ?? "";

const hooksOf = (value: unknown): RendererHooks =>
  Object.fromEntries(
    HOOKS.flatMap((name) => {
      const hook = (value as RendererHooks | null | undefined)?.[name];
      return typeof hook === "function" ? [[name, hook.bind(value)]] : [];
    })
  );

/** The tags `entry`'s module lists as never defined on the server (`@excom/nucleus-kit/server`'s). */
const excludedBy = (value: unknown): readonly string[] => {
  const tags = (value as { SERVER_EXCLUDED_TAGS?: unknown } | null | undefined)
    ?.SERVER_EXCLUDED_TAGS;
  return Array.isArray(tags) ? tags : [];
};

/** The window's pending work after one macrotask: empty lists when idle. */
const pendingNow = async (window: DomWindow): Promise<PendingWork> => {
  try {
    return await whenIdle(window, { quiet: 1, timeout: 0 });
  } catch (error) {
    return (error as { pending: PendingWork }).pending;
  }
};

const isQuiet = ({ requests, timers, frames }: PendingWork) =>
  !requests.length && !timers.length && !frames;

/**
 * The `<head>` nodes the shell parses into; call right before the parse.
 * The observer's first delivery runs before any task or microtask the
 * parse queued, so it sees the shell's nodes and only those appended
 * synchronously while it parsed.
 */
const watchShellHead = (window: DomWindow): (() => ReadonlySet<Node>) => {
  let parsed: ReadonlySet<Node> = new Set();
  const observer = new window.MutationObserver(() => {
    parsed = new Set(Array.from(window.document.head.childNodes));
    observer.disconnect();
  });
  observer.observe(window.document.documentElement, { childList: true });
  return () => {
    observer.disconnect();
    return parsed;
  };
};

/** `fetch()` calls in flight, as `createDom()` tracks them: `serve()` tells them from resource loads so too. */
const fetchCallsOf = (window: DomWindow): ReadonlyMap<Request, string> =>
  (window as unknown as Record<symbol, { requests: Map<Request, string> }>)[
    ACTIVITY
  ].requests;

/**
 * A renderer for server-side rendering (SSR) at build time: one happy-dom
 * window serving `root` at `origin`, with the app's elements loaded by
 * `entry`. Each `render(url)` loads the shell at that URL, lets the
 * elements render it until it settles, and returns static HTML plus a
 * hydration island (provisions and responses) the browser-side kit picks up
 * instead of fetching and rendering again. Resources of other origins
 * (stylesheets, frames) are skipped; iframes load no page, WebSockets
 * open none. A request of another scheme (`file:`, `data:`, `blob:`) is
 * refused before it is performed and fails the page; a `data:` image
 * source, never fetched, does not. A page with an element still
 * `is-loading` or `delaying-ready` once settled fails, as does one whose
 * HTML a browser parses into other elements than the renderer rendered
 * (block content inside a `<p>`), whose hydration would not match. Node
 * only.
 */
export async function createRenderer({
  root,
  origin,
  entry,
  shell,
  fallback,
  api,
  viewport,
  holdTimersAbove = 100,
  budgetMs = 5000,
  exclude,
  excludedTags = [],
  onError = "fail",
  warnIslandBytes,
}: RendererOptions): Promise<Renderer> {
  const base = new URL(origin).origin;
  const rootPath = pathOf(root);
  // read before any page renders: a prerender may overwrite the file
  const shellSource =
    shell ??
    builtin("node:fs").readFileSync(
      builtin("node:path").join(rootPath, "index.html"),
      "utf8"
    );
  // the build machine's paths a page must never hold: at least two segments
  // deep, so `/` or `/app` match no site URL
  const buildPaths = [rootPath, cwd()]
    .filter((path) => /[\\/][^\\/]+[\\/]/.test(path))
    .flatMap((path) => [path, path.replaceAll("\\", "/")]);
  const global = globalThis as typeof globalThis & {
    __NUCLEUS_SSR__?: ServerRender;
    [OPEN]?: true;
  };
  // the globals point at one window: a second renderer would take them over
  if (global[OPEN])
    throw new Error("nucleus-ssr: another renderer is open; close it first");
  const known = new Set(Reflect.ownKeys(globalThis));
  global[OPEN] = true;
  const { window, document, dispose } = createDom({
    url: `${base}/`,
    viewport,
    holdTimersAbove,
    intersectAll: true,
    settings: { disableIframePageLoading: true },
  });
  // parses each shell where no element is defined and nothing loads
  const parser = inertDom();
  // digests of the page sources a browser parses as the renderer does: each
  // parsed once, and per-route shells not kept whole
  const sound = new Set<string>();
  /** Throws when a browser parses `html`, the shell `source` names, into other elements than the renderer. */
  const checkShell = (html: string, source?: string) => {
    const digest = kit.hashString(html);
    if (sound.has(digest)) return;
    const difference = findParseDifference(parser.window, html);
    if (difference) throw misparsedShell(difference, source);
    sound.add(digest);
  };
  // the page being rendered; between pages, a sink nobody reads
  let page = idlePage();
  const served = serve(window, rootPath, {
    fallback,
    readOnly: true,
    api:
      api &&
      (async (request) => {
        const response = await api(request);
        const reason = response ? privacyOf(response.headers) : undefined;
        if (reason)
          page.diagnostics.errors.push(
            `Private response to ${request.method} ${request.url} (${reason}): a public page must not be built from it`
          );
        return response;
      }),
  });
  // element code's `fetch()`: from another origin it fails, as data the page
  // needs. Any other load from there (a stylesheet) is skipped
  const calls = fetchCallsOf(window);
  const fetchSettings = (
    window as unknown as {
      happyDOM: { settings: { fetch: { interceptor: Interceptor } } };
    }
  ).happyDOM.settings.fetch;
  const serving = fetchSettings.interceptor;
  /** A request of another scheme (`file:`, `data:`, `blob:`): refused before it is performed. */
  const refuses = ({ method, url }: Request) => {
    if (WEB.test(new URL(url).protocol)) return false;
    page.diagnostics.errors.push(
      `Refused ${method} ${clip(url)}: a render loads http(s) URLs only`
    );
    return true;
  };
  fetchSettings.interceptor = {
    ...serving,
    beforeAsyncRequest: async (context) => {
      const { request } = context;
      // `fetch()` gets a network error; a stylesheet or preload, nothing
      if (refuses(request))
        return calls.has(request)
          ? context.window.Response.error()
          : new context.window.Response("");
      if (new URL(request.url).origin === base || calls.has(request))
        return serving.beforeAsyncRequest(context);
      page.diagnostics.warnings.push(
        `Skipped ${request.method} ${request.url}: a render loads no resource from another origin`
      );
      return new context.window.Response("");
    },
    beforeSyncRequest: (context) => {
      if (refuses(context.request))
        throw new context.window.DOMException(
          `Failed to fetch ${clip(context.request.url)}`,
          "NetworkError"
        );
      return serving.beforeSyncRequest(context);
    },
  };
  // happy-dom's would connect to the server: live data no page is built from
  (window as unknown as { WebSocket: unknown }).WebSocket = class {
    constructor(url: string | URL) {
      page.diagnostics.errors.push(
        `Refused WebSocket ${url}: a render opens no socket`
      );
      throw new window.DOMException(
        "a render opens no socket",
        "SecurityError"
      );
    }
  };
  const unwatch = watchErrorEvents(document, () => page.diagnostics.errors);
  const restoreGlobals = installGlobals(window);
  const teardown = async () => {
    // the last page's elements tear down while the globals are still theirs
    await resetDocument(window, { url: `${base}/` });
    unwatch();
    restoreGlobals();
    await dispose();
    await parser.dispose();
    Reflect.ownKeys(globalThis)
      .filter((key) => !known.has(key))
      .forEach((key) => Reflect.deleteProperty(globalThis, key));
  };
  let hooks: RendererHooks;
  let kit: typeof import("@excom/kit-utils");
  try {
    // a cached entry module defines nothing in this window
    const registry = window.customElements;
    const define = registry.define;
    let defines = 0;
    registry.define = (...args: Parameters<typeof define>) => {
      defines++;
      return define.apply(registry, args);
    };
    let loaded: unknown;
    try {
      loaded = await entry();
    } finally {
      delete (registry as Partial<CustomElementRegistry>).define;
    }
    if (!defines)
      throw new Error(
        "nucleus-ssr: entry defined no custom element in this window. Modules evaluate once per process: create one renderer per entry, in a process of its own"
      );
    hooks = hooksOf(loaded);
    const defined = [...excludedTags, ...excludedBy(loaded)].filter((tag) =>
      registry.get(tag)
    );
    if (defined.length)
      throw new Error(
        `nucleus-ssr: excluded elements are defined: ${defined.join(", ")}`
      );
    // browser code: loaded once the window's globals are in place
    kit = await import("@excom/kit-utils");
    if (
      typeof shellSource === "string" &&
      parsedIn(parser.window, shellSource, ({ documentElement }) =>
        documentElement.hasAttribute(kit.SSR_ATTR)
      )
    )
      throw staleShell(kit);
    if (typeof shellSource === "string") checkShell(shellSource);
    // what a browser gets for a route with no page
    const fallbackSource =
      fallback && readText(builtin("node:path").join(rootPath, fallback));
    if (fallbackSource) checkShell(fallbackSource, `fallback ${fallback}`);
  } catch (error) {
    await teardown();
    throw error;
  }

  /** Resolves the held timers once the window and the `settle` hook are quiet in one pass. */
  const settle = async (): Promise<PendingWork> => {
    const deadline = Date.now() + budgetMs;
    const left = () => Math.max(0, deadline - Date.now());
    for (;;) {
      const idle = await whenIdle(window, { timeout: left() });
      if (!hooks.settle) return idle;
      if ((await within(hooks.settle(), left())) === EXPIRED)
        throw Object.assign(new Error("settle hook pending"), {
          pending: await pendingNow(window),
        });
      const after = await pendingNow(window);
      if (isQuiet(after)) return after;
    }
  };

  const renderPage = async (url: string): Promise<RenderResult> => {
    const target = new URL(url, `${base}/`);
    if (target.origin !== base)
      throw new TypeError(`nucleus-ssr: ${url} is not on ${base}`);
    const path = target.pathname + target.search + target.hash;
    const state = idlePage();
    const { diagnostics } = state;
    const server: ServerRender = { responses: [], exclude };
    // set right before the parse: serializing needs a parsed page
    let shellHead!: () => ReadonlySet<Node>;
    let html: string | undefined;
    let output: string | undefined;
    // whatever page is current: the previous one's teardown is not this one's
    const release = captureConsole(() => page.diagnostics);
    try {
      html =
        typeof shellSource === "function"
          ? await shellSource(path)
          : shellSource;
      await resetDocument(window, {
        url: target.href,
        html,
        beforeParse: async () => {
          // the previous page is gone and settled: what follows is this one's
          served.requests.length = 0;
          readVirtualConsole(window, emptyDiagnostics());
          page = state;
          // a new object per page: kit-utils starts its caches afresh
          global.__NUCLEUS_SSR__ = server;
          await hooks.beforeRender?.({ url: path, window });
          shellHead = watchShellHead(window);
        },
      });
      // e.g. `index.html` from an earlier prerender: stale content, ids, island
      if (document.documentElement.hasAttribute(kit.SSR_ATTR))
        throw staleShell(kit);
      checkShell(html, `route ${path}`);
      diagnostics.heldTimers = (await settle()).held;
      await hooks.afterRender?.({ url: path, window, document });
      // e.g. a `ready-on` event that never came: the page would be written half-rendered
      const waiting = notReady(document);
      if (waiting.length)
        diagnostics.errors.push(
          `Not ready once settled: ${waiting.join(", ")}`
        );
      const doctype = doctypeOf(html);
      const serialized = parsedIn(parser.window, html, (parsed) =>
        serialize(document, {
          names: kit,
          responses: server.responses,
          shell: { head: shellHead(), parsed },
          doctype,
        })
      );
      output = serialized.html;
      // the rendered tree against what a browser builds from its file: block
      // content rendered into a <p> moves out, then renders again
      const difference = findParseDifference(document, output);
      diagnostics.errors.push(
        ...serialized.errors,
        ...(difference
          ? [
              `The page parses differently in a browser: ${describeParseDifference(difference, output)}`,
            ]
          : []),
        ...(buildPaths.some((buildPath) => output!.includes(buildPath))
          ? [
              "The page holds a path of the build machine (root or the working directory)",
            ]
          : [])
      );
      Object.assign(diagnostics, {
        skippedProvisions: serialized.skippedProvisions,
        neutralizedScripts: serialized.neutralizedScripts,
        neutralizedShadowRoots: serialized.neutralizedShadowRoots,
        islandBytes: serialized.islandBytes,
      });
    } catch (error) {
      // no policy applies: under "shell", that shell would be written back
      if (error instanceof ShellError) throw error;
      const { pending } = error as { pending?: PendingWork };
      diagnostics.pending = pending;
      diagnostics.errors.push(
        pending
          ? `Not settled within budgetMs (${budgetMs} ms): ${(error as Error).message}`
          : `${html === undefined ? "shell: " : ""}${describe(error)}`
      );
    } finally {
      release();
      delete global.__NUCLEUS_SSR__;
      page = idlePage();
    }
    readVirtualConsole(window, diagnostics);
    diagnostics.requests = served.requests.map((request) => ({ ...request }));
    diagnostics.requests
      .filter(({ method }) => !SAFE_METHODS.includes(method))
      .forEach(({ method, url: refused }) =>
        diagnostics.errors.push(
          `Refused ${method} ${refused}: a render is read-only`
        )
      );
    if (diagnostics.islandBytes > (warnIslandBytes ?? Infinity))
      diagnostics.warnings.push(
        `Island is ${diagnostics.islandBytes} bytes (warnIslandBytes: ${warnIslandBytes})`
      );
    if (!diagnostics.errors.length) return { html: output!, diagnostics };
    const policy = typeof onError === "function" ? onError(path) : onError;
    if (policy === "shell" && html !== undefined) return { html, diagnostics };
    throw Object.assign(
      new Error(
        `nucleus-ssr: ${path} failed: ${diagnostics.errors.join("; ")}`
      ),
      { diagnostics }
    );
  };

  let closed = false;
  let turn = Promise.resolve();
  return {
    window,
    async render(url) {
      if (closed) throw new Error("nucleus-ssr: the renderer is closed");
      const previous = turn;
      let done!: () => void;
      turn = new Promise((resolve) => (done = resolve));
      try {
        await previous;
        return await renderPage(url);
      } finally {
        done();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await turn;
      await teardown();
    },
  };
}
