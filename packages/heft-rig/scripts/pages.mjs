// Cloudflare Pages rules of a built site (`_redirects` 200 rewrites, `_headers`,
// `404.html`), written once: `servePages` serves a site with them (the browser
// checks), `pagesMiddleware` applies them in front of the rig's `preview` server.
// Both read a request the same way and take its answer from `answerOf`.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, posix, relative, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".quark": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const TEXT = "text/plain; charset=utf-8";
const ORIGIN = "http://localhost";

// a local server never caches, and HSTS would pin `localhost` if a preview ran over HTTPS
const LEFT_OUT = new Set(["cache-control", "strict-transport-security"]);

const lines = (text) =>
  text.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));

/** `/a/*` matches `/a/` and below, as on Pages. */
export const pathMatcher = (pattern) => {
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${source}$`);
};

/** `[test, to]` for each `from to 200` line. */
export const rewritesOf = (text) =>
  lines(text)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, , status]) => status === "200")
    .map(([from, to]) => [pathMatcher(from), to]);

/** `[test, [name, value][]]` for each path block. */
export const headersOf = (text) =>
  lines(text).reduce((rules, line) => {
    if (!/^\s/.test(line)) return [...rules, [pathMatcher(line.trim()), []]];
    const [name, ...value] = line.trim().split(":");
    rules.at(-1)?.[1].push([name.trim(), value.join(":").trim()]);
    return rules;
  }, []);

/** A header named more than once takes its values joined with `, `, as on Pages. */
const joined = (pairs) =>
  [...Map.groupBy(pairs, ([name]) => name.toLowerCase()).values()].map((same) => [
    same[0][0],
    same.map(([, value]) => value).join(", "),
  ]);

/**
 * Rules of the site in `root`, none for a missing file: `rewrite(pathname)` is where
 * a 200 rule sends the path, `headers(pathname)` the `[name, value][]` of every
 * matching block, a header named twice with its values joined by `, `. Left out:
 * `Cache-Control` (a local server never caches) and `Strict-Transport-Security`
 * (it would pin `localhost` if a preview ever ran over HTTPS).
 */
export const rulesOf = async (root) => {
  const read = (file) => readFile(join(root, file), "utf8").catch(() => "");
  const [redirects, headers] = await Promise.all([read("_redirects"), read("_headers")]);
  const [rewrites, blocks] = [rewritesOf(redirects), headersOf(headers)];
  return {
    rewrite: (pathname) => rewrites.find(([test]) => test.test(pathname))?.[1],
    headers: (pathname) =>
      joined(
        blocks
          .filter(([test]) => test.test(pathname))
          .flatMap(([, pairs]) => pairs)
          .filter(([name]) => !LEFT_OUT.has(name.toLowerCase()))
      ),
  };
};

const decodePath = (pathname) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

/**
 * `{ pathname, search }` of a request target, none unless it is a path to serve.
 * An origin-form target is put after the origin, never resolved against it, so
 * `//host/…` and `/\host/…` cannot name another host: they are refused.
 */
const targetOf = (target = "/") => {
  try {
    const { pathname, search } = new URL(target.startsWith("/") ? ORIGIN + target : target);
    return /^\/(?!\/)/.test(pathname) ? { pathname, search } : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A request read against the rules, none when its target is unreadable: the
 * `search`, the rewrite target `to`, the decoded `path` to look up (a rewrite
 * target is a URL too) and the `headers`.
 */
const readRequest = (rules, target) => {
  const read = targetOf(target);
  if (!read) return undefined;
  const to = rules.rewrite(read.pathname);
  return {
    search: read.search,
    to,
    rewritten: to !== undefined,
    path: decodePath(to ?? read.pathname),
    headers: rules.headers(read.pathname),
  };
};

const inside = (root, file) => {
  const from = relative(root, file);
  return from !== "" && from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from);
};

/** First of `files` that is a file inside `root`: nothing above it is looked at. */
const firstFile = async (root, files) => {
  for (const file of files.filter((file) => inside(root, file))) {
    if ((await stat(file).catch(() => null))?.isFile()) return file;
  }
  return undefined;
};

/**
 * What the site in `root` answers for a request `path` (decoded, after any
 * rewrite): the `file` that serves it (`a/b` itself, `a/b.html` or
 * `a/b/index.html`), the URL it is `moved` to, or `{}` for nothing. A page has one
 * URL, as on Pages: `/a/b/` moves to `/a/b` when `a/b.html` is the page, unless a
 * rule sent the request there (`rewritten`).
 */
export const answerOf = async (root, { path, rewritten = false }) => {
  const page = posix.normalize(path).replace(/^\/+|\/+$/g, "");
  const slash = path.endsWith("/");
  const [exact, html, index] = [page, `${page}.html`, `${page}/index.html`].map((file) =>
    join(root, file)
  );
  const files = slash ? [index, html, exact] : [exact, html, index];
  const file = await firstFile(root, page ? files : [index]);
  if (file === html && slash && !rewritten) {
    return { moved: `/${page.split("/").map(encodeURIComponent).join("/")}` };
  }
  return file ? { file } : {};
};

const send = (res, status, headers, body) => {
  res.statusCode = status;
  for (const [name, value] of Object.entries({ ...headers, "cache-control": "no-store" })) {
    res.setHeader(name, value);
  }
  res.end(body);
};

/**
 * `(req, res)` for the site in `root`: serves the file, moves to the page's URL or
 * sends `404.html` as a 404 (plain text without one). An unreadable URL is a 400,
 * any other failure a 500: it never rejects.
 */
export const pagesHandler = async (root) => {
  const rules = await rulesOf(root);
  const respond = async (req, res) => {
    const request = readRequest(rules, req.url);
    if (!request) return send(res, 400, { "content-type": TEXT }, "Bad request");
    const headers = Object.fromEntries(request.headers);
    const { file, moved } = await answerOf(root, request);
    if (moved) return send(res, 308, { ...headers, location: moved + request.search });
    if (file) {
      const type = TYPES[extname(file)] ?? "application/octet-stream";
      return send(res, 200, { ...headers, "content-type": type }, await readFile(file));
    }
    const page = await readFile(join(root, "404.html")).catch(() => null);
    return send(
      res,
      404,
      { ...headers, "content-type": page ? TYPES[".html"] : TEXT },
      page ?? "Not found"
    );
  };
  return (req, res) =>
    respond(req, res).catch((error) =>
      res.headersSent
        ? res.destroy()
        : send(res, 500, { "content-type": TEXT }, `Server error: ${error?.message ?? error}`)
    );
};

/** Serves the built site in `root` the way Pages does, never cached. */
export const servePages = async ({ root, port = 0 }) => {
  const server = createServer(await pagesHandler(root));
  await new Promise((ok, fail) => server.once("error", fail).listen(port, ok));
  return {
    port: server.address().port,
    close: () => (server.closeAllConnections(), server.close()),
  };
};

/** A page request as Vite's HTML fallback sees one: GET/HEAD, no extension, accepting HTML. */
const wantsPage = ({ method, headers: { accept = "" } }, path) =>
  (method === "GET" || method === "HEAD") &&
  !extname(path) &&
  (!accept || /text\/html|\*\/\*/.test(accept));

// Vite maps `/a` to `a.html` and `/a/` to `a/index.html`, nothing else
const viteFile = (root, path) =>
  join(root, path.endsWith("/") ? `${path}index.html` : `${path}.html`);

const fileUrl = (root, file) =>
  `/${relative(root, file).split(sep).map(encodeURIComponent).join("/")}`;

const applyRules = async (root, req, res, next) => {
  const request = readRequest(await rulesOf(root), req.url);
  if (!request) return next();
  const { path, search, to, headers } = request;
  for (const [name, value] of headers) res.setHeader(name, value);
  if (to !== undefined) req.url = to + search;
  if (!wantsPage(req, path)) return next();
  const { file, moved } = await answerOf(root, request);
  if (file) {
    // a page Vite would not find from the URL: point it at the file
    if (extname(file) === ".html" && file !== viteFile(root, path)) {
      req.url = fileUrl(root, file) + search;
    }
    return next();
  }
  if (moved) return send(res, 308, { location: moved + search });
  const body = await readFile(join(root, "404.html")).catch(() => null);
  if (!body) return next();
  send(res, 404, { "content-type": TYPES[".html"] }, body);
};

/**
 * Connect middleware over the built site in `root`, in front of Vite's own:
 * applies the 200 rewrites to `req.url`, sets the headers of the matching blocks,
 * moves `/a/b/` to `/a/b` when `a/b.html` is the page (one URL per page), lets
 * Vite serve the page otherwise and answers a page nothing serves with
 * `404.html` as a 404 (Vite would send `index.html`). Rules are read per request,
 * so a rebuild applies at once. An unreadable URL, a request that is not for a
 * page, and an unknown page of a site without `404.html` are left to Vite. A
 * failure, such as a header name `_headers` cannot have, goes to the server's
 * error handling.
 */
export const pagesMiddleware = (root) => (req, res, next) =>
  applyRules(root, req, res, next).catch(next);
