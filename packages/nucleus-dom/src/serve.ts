import { activityOf } from "./activity";
import { builtin } from "./node";
import type { DomWindow } from "./window";
import type { IBrowserSettings, IFetchInterceptor } from "happy-dom";

/** Answers a same-origin `/api/*` request; `null` / `undefined` leaves it to the files. */
export type ApiHandler = (
  request: Request
) => Response | null | undefined | Promise<Response | null | undefined>;

export interface ServeOptions {
  /**
   * File under `root` for an extensionless path with no file of its own:
   * SPA deep links, e.g. `"index.html"`. A path with a dot never falls back.
   */
  fallback?: string;
  /**
   * Answers `/api/*` first, any method: a mock backend, a service worker's
   * fetch handler. Synchronous requests never reach it.
   */
  api?: ApiHandler;
  /**
   * Refuses methods other than GET / HEAD with 405, before `api` sees them:
   * a prerender never writes. Off, `api` still takes them; files never do.
   */
  readOnly?: boolean;
}

/** One request `serve()` saw. `status` 0: a network error, aborted or still in flight. */
export interface ServedRequest {
  method: string;
  url: string;
  status: number;
}

export interface Served {
  /** The window's http(s) requests, in order: diagnostics. Empty it between pages. */
  requests: ServedRequest[];
}

type Win = DomWindow | typeof globalThis;
type Hooks = Required<IFetchInterceptor>;
/** An answer `serve` makes up itself. */
type Reply = {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: Uint8Array<ArrayBuffer> | string;
};
/** What `serve` sends: a status and headers, typed after the virtual server read a file. */
type Answered = { ok: boolean; status: number; headers: Headers };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".quark": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};
const SAFE = ["GET", "HEAD"];
const TEXT = { "content-type": TYPES[".txt"] };
const REFUSED: Reply = {
  status: 405,
  statusText: "Method Not Allowed",
  headers: { allow: SAFE.join(", ") },
};

const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/** `response` as one of `win`'s own: happy-dom ignores any other. */
const adopt = async (win: Win, response: Response): Promise<Response> => {
  if ((response as object) instanceof win.Response) return response;
  if (response.type === "error") return win.Response.error();
  const body = await response.arrayBuffer();
  return new win.Response(body.byteLength ? body : null, {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
  });
};

/**
 * Serves the directory `root` (a path or `file:` URL) at the window's
 * origin, like a static dev server, to `fetch()` and to resource loads such
 * as `<link rel="stylesheet">`: test or server-render (SSR) a site offline.
 * Other origins get a network error; every request is logged. Replaces the
 * window's fetch interceptor and virtual servers.
 */
export function serve(
  win: Win,
  root: string | URL,
  { fallback, api, readOnly = false }: ServeOptions = {}
): Served {
  const { readFileSync, realpathSync, statSync } = builtin("node:fs");
  const { extname, isAbsolute, join, relative, resolve, sep } =
    builtin("node:path");
  const { Buffer } = builtin("node:buffer");
  const base = resolve(
    String(root).startsWith("file:")
      ? builtin("node:url").fileURLToPath(root)
      : String(root)
  );
  const realBase = statSync(base, { throwIfNoEntry: false })
    ? realpathSync(base)
    : base;
  const requests: ServedRequest[] = [];
  const inFlight = activityOf(win)?.requests;
  // files left to the virtual server: typed and logged once it answers
  const passed = new WeakMap<object, (answered: Answered) => void>();
  const typeOf = (path: string) =>
    TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const inside = (path: string) => {
    const rest = relative(realBase, realpathSync(path));
    return !isAbsolute(rest) && rest !== ".." && !rest.startsWith(`..${sep}`);
  };
  const fileAt = (segments: string[]): string | undefined => {
    const path = join(base, ...segments);
    const stat = statSync(path, { throwIfNoEntry: false });
    // a symlink out of `root` is not there
    if (!stat || !inside(path)) return undefined;
    return stat.isDirectory() ? fileAt([...segments, "index.html"]) : path;
  };

  /** A reply, or the file the virtual server reads for a plain GET. */
  const local = (method: string, url: URL): Reply | string => {
    if (!SAFE.includes(method)) return REFUSED;
    const segments = url.pathname.slice(1).split("/").map(decode);
    if (segments.some((segment) => segment === null || segment.includes("\0")))
      return {
        status: 400,
        statusText: "Bad Request",
        headers: TEXT,
        body: `Bad request: ${url.pathname}`,
      };
    const names = segments as string[];
    // an encoded `/` names no file
    const file = names.some((name) => /[\\/]/.test(name))
      ? undefined
      : fileAt(names);
    // the virtual server reads the URL's own path, undecoded
    if (file && method === "GET" && !url.pathname.includes("%")) return file;
    const found =
      file ??
      (fallback && !extname(names.at(-1)!)
        ? fileAt(fallback.split("/"))
        : undefined);
    return found
      ? {
          status: 200,
          headers: { "content-type": typeOf(found) },
          body: method === "HEAD" ? undefined : readFileSync(found),
        }
      : {
          status: 404,
          headers: TEXT,
          body: `Not found: ${url.pathname}`,
        };
  };
  const route = async (
    request: Request,
    window: Win
  ): Promise<Response | string | undefined> => {
    const url = new URL(request.url);
    if (url.origin !== window.location.origin) return window.Response.error();
    if (readOnly && !SAFE.includes(request.method))
      return reply(window, REFUSED);
    const answer = url.pathname.startsWith("/api/") && (await api?.(request));
    if (request.signal.aborted) return undefined;
    if (answer) return adopt(window, answer);
    const next = local(request.method, url);
    return typeof next === "string" ? next : reply(window, next);
  };
  const reply = (window: Win, { body, ...init }: Reply) =>
    new window.Response(body ?? null, init);
  const log = (request: Request) => {
    const entry = { method: request.method, url: request.url, status: 0 };
    requests.push(entry);
    return entry;
  };
  /** Leaves `file` to the virtual server; `done` gets the status it answers. */
  const pass = (
    request: Request,
    file: string,
    done: (status: number) => void
  ) =>
    passed.set(request, (answered) => {
      if (answered.ok) answered.headers.set("content-type", typeOf(file));
      done(answered.status);
    });
  const http = (request: Request) =>
    /^https?:$/.test(new URL(request.url).protocol);

  const beforeAsyncRequest = async ({
    request,
    window,
  }: {
    request: Request;
    window: Win;
  }) => {
    if (!http(request)) return undefined;
    const entry = log(request);
    // `fetch()` calls are tracked by the window; resource loads here
    const tracked = !!inFlight && !inFlight.has(request);
    if (tracked) inFlight.set(request, `${entry.method} ${entry.url}`);
    const end = (status = 0) => {
      if (tracked) inFlight.delete(request);
      entry.status = status;
    };
    const answer = await route(request, window).catch((error: unknown) => {
      window.console.error(error);
      return new window.Response(String(error), { status: 500 });
    });
    if (typeof answer === "string") {
      pass(request, answer, end);
      return undefined;
    }
    end(answer?.status);
    if (answer && answer.type !== "error" && !answer.url)
      Object.assign(answer, { url: request.url });
    return answer;
  };
  const beforeSyncRequest = ({
    request,
    window,
  }: {
    request: Request;
    window: Win;
  }) => {
    if (!http(request)) return undefined;
    const entry = log(request);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin)
      throw new window.DOMException(
        `Failed to fetch ${url.href}`,
        "NetworkError"
      );
    const next = local(request.method, url);
    if (typeof next === "string") {
      pass(request, next, (status) => (entry.status = status));
      return undefined;
    }
    entry.status = next.status;
    return {
      status: next.status,
      statusText: next.statusText ?? "",
      ok: next.status < 300,
      url: request.url,
      redirected: false,
      headers: new window.Headers(next.headers),
      body: next.body === undefined ? null : Buffer.from(next.body),
    };
  };
  const afterResponse = ({
    request,
    response,
  }: {
    request: Request;
    response: Answered;
  }) => {
    passed.get(request)?.(response);
    passed.delete(request);
    return undefined;
  };

  const { fetch } = (
    win as unknown as { happyDOM: { settings: IBrowserSettings } }
  ).happyDOM.settings;
  fetch.virtualServers = [{ url: "/", directory: base }];
  fetch.interceptor = {
    beforeAsyncRequest,
    beforeSyncRequest,
    afterAsyncResponse: async (context: {
      request: Request;
      response: Answered;
    }) => afterResponse(context),
    afterSyncResponse: afterResponse,
  } as unknown as Hooks;
  return { requests };
}
