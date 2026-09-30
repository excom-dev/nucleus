import { builtin } from "./node";

/** Answers a same-origin `/api/*` request; `null` / `undefined` leaves it to the files. */
export type ApiHandler = (
  request: Request
) => Response | null | undefined | Promise<Response | null | undefined>;

export interface ServeStaticOptions {
  /** File under `root` for an extensionless path with no file of its own: SPA deep links, e.g. `"index.html"`. */
  fallback?: string;
  /** Answers `/api/*`: a mock backend, a service worker's fetch handler. */
  api?: ApiHandler;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".quark": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

const decode = (pathname: string): string | undefined => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
};

/**
 * A `fetch` stand-in serving the directory `root` (a path or `file:` URL) at
 * the page's origin, like a static dev server: templates, Quark sheets, JSON.
 * `/api/*` goes to `api` first; other origins reject as offline. Node only.
 *
 * `vi.spyOn(globalThis, "fetch").mockImplementation(serveStatic(root, { fallback: "index.html" }))`
 */
export const serveStatic = (
  root: string | URL,
  { fallback, api }: ServeStaticOptions = {}
) => {
  const { readFileSync, statSync } = builtin("node:fs");
  const { extname, join, relative, resolve } = builtin("node:path");
  const { fileURLToPath } = builtin("node:url");
  const base = resolve(
    String(root).startsWith("file:") ? fileURLToPath(root) : String(root)
  );
  const fileOf = (pathname: string): string | undefined => {
    const path = join(base, pathname);
    if (relative(base, path).startsWith("..")) return undefined;
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat?.isDirectory()) return fileOf(join(pathname, "index.html"));
    if (stat) return path;
    return fallback && !extname(pathname) ? join(base, fallback) : undefined;
  };
  const respond = (url: URL): Response => {
    const pathname = decode(url.pathname);
    const file = pathname === undefined ? undefined : fileOf(pathname);
    return file
      ? new Response(readFileSync(file), {
          headers: {
            "content-type": TYPES[extname(file)] ?? "application/octet-stream",
          },
        })
      : new Response(`Not found: ${url.pathname}`, {
          status: 404,
          headers: { "content-type": TYPES[".txt"] },
        });
  };
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const request = new Request(
      input instanceof Request ? input : new URL(String(input), location.href),
      init
    );
    const url = new URL(request.url);
    if (url.origin !== location.origin)
      throw new TypeError(`Failed to fetch ${url.href}: offline`);
    const answer =
      (url.pathname.startsWith("/api/") && (await api?.(request))) ||
      respond(url);
    request.signal.throwIfAborted();
    return Object.defineProperty(answer, "url", { value: url.href });
  };
};
