// The host of a built site, Cloudflare Workers static assets, emulated: the
// `_redirects` and `_headers` of the build, and the `assets` options of the
// site's `wrangler.jsonc` or `wrangler.json` (`not_found_handling`: `none`,
// `404-page`, `single-page-application`; `html_handling`: `auto-trailing-slash`).
// What it does not emulate, it refuses. `answerOf` decides, `hostHandler`
// answers (`vite preview` with `nucleus()`), `serveSite` listens (browser checks;
// with `shell`, as if the site were never prerendered).
//
// Portions ported from cloudflare/workers-sdk `packages/workers-shared`
// (`asset-worker/src/handler.ts`; `utils/configuration/parseRedirects.ts` and
// `parseHeaders.ts` for the grammar), Copyright (c) 2020 Cloudflare, Inc.,
// licensed MIT OR Apache-2.0, used here under the MIT licence
// (THIRD-PARTY-NOTICES.md).
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, posix, resolve } from "node:path";

// as the host types an upload: the `mime` package's type, `text/*` with a
// charset; any other extension is `application/octet-stream`
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "application/node",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".quark": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/vnd.microsoft.icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};
const TEXT = "text/plain; charset=utf-8";
// the host answers over HTTPS: a rule's `//a` is `https://a/`
const ORIGIN = "https://localhost";
const SAFE = ["GET", "HEAD"];
const REDIRECTS = [301, 302, 303, 307, 308];
const HTTPS = /^https:\/\/+(?<host>[^/]+)\/?(?<path>.*)/;
const DYNAMIC = /\*|:[A-Za-z]\w*/;

/** Read by the host at deploy, never served. */
const METAFILES = new Set(["/_redirects", "/_headers", "/.assetsignore"]);

// a local server never caches, and HSTS would pin `localhost` if a preview ran over HTTPS
const LEFT_OUT = new Set(["cache-control", "strict-transport-security"]);

/** The host's defaults, and what this emulation supports. */
const HANDLING = {
  not_found_handling: ["none", "404-page", "single-page-application"],
  html_handling: ["auto-trailing-slash"],
};

const lines = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

/** A path as the host stores it: `//a` is `/a`, a space `%20`; the query and hash kept on request. */
const pathnameOf = (path, query) => {
  const url = new URL(`//${path.startsWith("/") ? path : `/${path}`}`, "relative://");
  return `${url.pathname}${query ? `${url.search}${url.hash}` : ""}`;
};

/** A `_redirects` / `_headers` URL the host accepts (`validateUrl`), undefined for one it drops. */
const urlOf = (token, { relative = false, ports = true, query = false } = {}) => {
  const host = HTTPS.exec(token)?.groups;
  if (host?.host)
    return relative || (!ports && /:\d+$/.test(host.host))
      ? undefined
      : `https://${host.host}${pathnameOf(host.path, query)}`;
  const path = relative && !token.startsWith("/") ? `/${token}` : token;
  return path.startsWith("/") ? pathnameOf(path, query) : undefined;
};

/** A rule's pattern: `*` is `:splat`, `:name` one segment; undefined for one the host cannot compile. */
const patternOf = (rule) => {
  try {
    const source = rule
      .split("*")
      .map((part) => part.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
      .join("(?<splat>.*)")
      .replace(/:([A-Za-z]\w*)/g, "(?<$1>[^/]+)");
    return new RegExp(`^${source}$`);
  } catch {
    return undefined;
  }
};

/** `:splat` and `:name` of a match put into `text`. */
const placed = (text, groups = {}) =>
  Object.entries(groups).reduce((result, [name, value]) => result.replaceAll(`:${name}`, value), text);

/**
 * `{ from, to, status }` per line the host keeps: `from to [status]`, the status
 * 302 by default, a `#` after a space starting a comment. Dropped, as the host
 * drops them: another token count or status, a `from` with a host, a repeated
 * `from`, a `200` to another site, a rule that would loop through `html_handling`
 * (`/* /index.html`).
 */
export const redirectsOf = (text, html = HANDLING.html_handling[0]) => {
  const seen = new Set();
  return lines(text).flatMap((line) => {
    const tokens = line.replace(/\s+#.*$/, "").split(/\s+/);
    if (tokens.length < 2 || tokens.length > 3) return [];
    const [from, to, status] = [
      urlOf(tokens[0], { relative: true, ports: false }),
      urlOf(tokens[1], { query: true }),
      Number(tokens[2] ?? 302),
    ];
    if (!from || !to || ![200, ...REDIRECTS].includes(status) || seen.has(from)) return [];
    const external = HTTPS.test(to);
    const loops =
      !external &&
      /\/index(.html)?$/.test(to) &&
      (from.endsWith("/*") || (from.endsWith("/") && html !== "none"));
    if (loops || (status === 200 && external)) return [];
    seen.add(from);
    return [{ from, to, status }];
  });
};

/**
 * `{ path, set, unset }` per path block, as the host reads `_headers`: a path line
 * starts with `/` (or a scheme), `name: value` lines add to the block above
 * (names lower-cased, a repeated name joined with `, `), `! name` removes a header.
 * A later block for the same path replaces an earlier one. Throws on a rule for a
 * host: not emulated.
 */
export const headersOf = (text) => {
  const blocks = new Map();
  const close = (block) =>
    block && (Object.keys(block.set).length || block.unset.length) && blocks.set(block.path, block);
  const last = lines(text).reduce((block, line) => {
    if (/^([^\s]+:\/\/|\/)/.test(line)) {
      close(block);
      const path = urlOf(line, { ports: false });
      if (path && HTTPS.test(path)) throw new Error(`_headers: "${line}" names a host, which is not emulated`);
      const wildcards = path?.split("*").length - 1;
      return path && wildcards < 2 && !(wildcards && /:splat(?!\w)/.test(path))
        ? { path, set: {}, unset: [] }
        : null;
    }
    if (!block) return block;
    if (!line.includes(":")) {
      if (line.startsWith("! ")) block.unset.push(line.slice(2));
      return block;
    }
    const [rawName, ...rawValue] = line.split(":");
    const [name, value] = [rawName.trim().toLowerCase(), rawValue.join(":").trim()];
    if (name && value && !name.includes(" ")) block.set[name] = block.set[name] ? `${block.set[name]}, ${value}` : value;
    return block;
  }, null);
  close(last);
  return [...blocks.values()];
};

/**
 * Rules of the build in `root`, none for a missing file. `redirect(pathname)`: the
 * `{ to, status }` of the matching `_redirects` line (the lines without `*` or
 * `:name` before the first one with them match exactly and first, the rest in
 * order, their target filled in). `headers(pathname)`: the `{ set, unset }` of
 * every matching `_headers` block, in order.
 */
export const rulesOf = async (root, html) => {
  const read = (file) => readFile(join(root, file), "utf8").catch(() => "");
  const redirects = redirectsOf(await read("_redirects"), html);
  const blocks = headersOf(await read("_headers")).flatMap((block) => {
    const test = patternOf(block.path);
    return test ? [{ ...block, test }] : [];
  });
  const split = redirects.findIndex(({ from }) => DYNAMIC.test(from));
  const exact = new Map(redirects.slice(0, split < 0 ? undefined : split).map((rule) => [rule.from, rule]));
  const dynamic = (split < 0 ? [] : redirects.slice(split)).flatMap((rule) => {
    const test = patternOf(rule.from);
    return test ? [{ ...rule, test }] : [];
  });
  return {
    redirect: (pathname) => {
      const fixed = exact.get(pathname);
      if (fixed) return { to: fixed.to, status: fixed.status };
      for (const { test, to, status } of dynamic) {
        const match = test.exec(pathname);
        if (!match) continue;
        const target = placed(to, match.groups).trim();
        return { to: /^\w+:\/\//.test(target) ? target : target.replace(/\/+/g, "/"), status };
      }
      return undefined;
    },
    headers: (pathname) =>
      blocks.flatMap(({ test, set, unset }) => {
        const match = test.exec(pathname);
        if (!match) return [];
        return [{ set: Object.entries(set).map(([name, value]) => [name, placed(value, match.groups)]), unset }];
      }),
  };
};

/**
 * The response headers: the asset's own, then `_headers` applied as the host
 * applies them (`! name` removes, a name's first value replaces, a later one is
 * appended). `Cache-Control` and `Strict-Transport-Security` are left out.
 */
const headersFor = (own, blocks) => {
  const headers = new Map(own);
  const named = new Set();
  for (const { set, unset } of blocks) {
    for (const name of unset) headers.delete(name.toLowerCase());
    for (const [name, value] of set) {
      headers.set(name, named.has(name) && headers.has(name) ? `${headers.get(name)}, ${value}` : value);
      named.add(name);
    }
  }
  return [...headers].filter(([name]) => !LEFT_OUT.has(name));
};

/** JSONC as JSON: comments and trailing commas dropped, strings untouched. */
const parseJsonc = (text) =>
  JSON.parse(
    text
      .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? "")
      .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (_, string, close) => string ?? close)
  );

/** Wrangler's config files, in the order it prefers them. */
const WRANGLER_FILES = ["wrangler.json", "wrangler.jsonc", "wrangler.toml"];

/**
 * The `assets` options the host serves the build in `root` with: those of the
 * nearest `wrangler.json` / `wrangler.jsonc` at or above `root` when its
 * `assets.directory` is `root`, else the host's defaults. Throws on what this
 * emulation lacks: a nearest `wrangler.toml`, another value, a Worker script
 * (`main`) or `run_worker_first`.
 */
export const hostOf = async (root) => {
  const find = async (dir) => {
    const texts = await Promise.all(
      WRANGLER_FILES.map((name) => readFile(join(dir, name), "utf8").catch(() => undefined))
    );
    const index = texts.findIndex((text) => text !== undefined);
    if (index >= 0) return { file: join(dir, WRANGLER_FILES[index]), text: texts[index] };
    return dirname(dir) === dir ? undefined : find(dirname(dir));
  };
  const found = await find(resolve(root));
  if (found?.file.endsWith(".toml"))
    throw new Error(`${found.file}: the preview follows the assets options of a wrangler.jsonc or wrangler.json only`);
  const { assets = {}, main } = found ? parseJsonc(found.text) : {};
  const own = assets.directory && resolve(dirname(found.file), assets.directory) === resolve(root);
  if (own && (main || assets.run_worker_first))
    throw new Error(`${found.file}: a Worker script (main, run_worker_first) is not emulated`);
  return Object.fromEntries(
    Object.entries(HANDLING).map(([key, values]) => {
      const value = (own && assets[key]) || values[0];
      if (!values.includes(value)) throw new Error(`${key} "${value}" is not emulated (${values.join(", ")})`);
      return [key, value];
    })
  );
};

/** Each segment decoded once, `//` collapsed, as the host reads a path. */
const decodePath = (pathname) =>
  pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/")
    .replace(/\/+/g, "/");

const encodePath = (pathname) => pathname.split("/").map(encodeURIComponent).join("/");

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
 * The file an asset path names in `root`, as the host's manifest would: the exact
 * path, letter case included (a file system may ignore it), never a directory, a
 * `.` / `..` segment, `//` or a metafile. Directory listings are read once per answer.
 */
const assetsOf = (root) => {
  const listings = new Map();
  const listing = (dir) => {
    if (!listings.has(dir)) listings.set(dir, readdir(dir, { withFileTypes: true }).catch(() => []));
    return listings.get(dir);
  };
  return async (path) => {
    if (posix.normalize(path) !== path || !path.startsWith("/") || path.endsWith("/") || METAFILES.has(path))
      return undefined;
    const names = path.slice(1).split("/");
    let dir = root;
    for (const [index, name] of names.entries()) {
      const entry = (await listing(dir)).find((candidate) => candidate.name === name);
      if (!entry || !(index === names.length - 1 ? entry.isFile() : entry.isDirectory())) return undefined;
      dir = join(dir, name);
    }
    return dir;
  };
};

const NOT_FOUND = {
  none: async () => null,
  "single-page-application": async (_, exists) => {
    const file = await exists("/index.html");
    return file ? { file, status: 200 } : null;
  },
  // the nearest `404.html`, climbing from the path's directory
  "404-page": async (pathname, exists) => {
    for (let dir = pathname; dir; ) {
      dir = dir.slice(0, dir.lastIndexOf("/"));
      const file = await exists(`${dir}/404.html`);
      if (file) return { file, status: 404 };
    }
    return null;
  },
};

/** `[file, destination]` pairs: a request for `file` moves to `destination` when that serves it. */
const movesOf = (path) => {
  const cut = (suffix) => path.slice(0, -suffix.length);
  if (path.endsWith("/index")) return [[`${path}.html`, cut("index")], [`${cut("/index")}.html`, cut("/index")]];
  if (path.endsWith("/index.html"))
    return [[path, cut("index.html")], [`${cut("/index.html")}.html`, cut("/index.html")]];
  if (path.endsWith("/")) return [[`${cut("/")}.html`, cut("/")]];
  if (path.endsWith(".html")) return [[path, cut(".html")], [`${cut(".html")}/index.html`, `${cut(".html")}/`]];
  return [];
};

/**
 * `auto-trailing-slash`: a page `a.html` answers at `/a`, a directory index at
 * `/a/`; any other spelling of either moves there. `{ file, status }`, `{ moved }`
 * or `null`.
 */
const autoTrailingSlash = async (path, exists, notFound, settling = false) => {
  const moveTo = async ([file, destination]) => {
    if (settling || (await exists(destination))) return undefined;
    const [served, named] = [await autoTrailingSlash(destination, exists, notFound, true), await exists(file)];
    return served?.file && served.file === named ? { moved: destination } : undefined;
  };
  const exact = await exists(path);
  const index = path.endsWith("/index") ? exact : path.endsWith("/") ? await exists(`${path}index.html`) : undefined;
  if (index) return { file: index, status: 200 };
  for (const move of movesOf(path)) {
    const moved = await moveTo(move);
    if (moved) return moved;
  }
  const file = exact ?? (await exists(`${path}.html`));
  if (file) return { file, status: 200 };
  return (await moveTo([`${path}/index.html`, `${path}/`])) ?? notFound(path, exists);
};

/** Where a `_redirects` line sends a request: its own query unless the rule has one. */
const locationOf = (to, search) => {
  const url = new URL(to, ORIGIN);
  const rest = `${url.search || search}${url.hash}`;
  return url.origin === ORIGIN ? `${url.pathname}${rest}` : `${url.origin}${url.pathname}${rest}`;
};

/**
 * What the host answers for a request to the build in `root`: `{ status, file?,
 * location?, headers }`, the headers the whole set it sends. `_redirects` comes
 * first (a `200` line serves its target at the requested URL), then the asset, a
 * move to its one URL (307), or the `not_found_handling` answer; the `_headers`
 * of the requested path go on every answer. An unreadable target is a 400.
 */
export const answerOf = async (root, { method = "GET", url } = {}) => {
  const target = targetOf(url);
  if (!target) return { status: 400, headers: [["content-type", TEXT]] };
  const host = await hostOf(root);
  const rules = await rulesOf(root, host.html_handling);
  const blocks = rules.headers(target.pathname);
  const answer = (status, own = [], extra = {}) => ({ status, ...extra, headers: headersFor(own, blocks) });
  const rule = rules.redirect(target.pathname);
  if (rule && REDIRECTS.includes(rule.status)) {
    const location = locationOf(rule.to, target.search);
    return answer(rule.status, [["location", location]], { location });
  }
  const path = rule ? new URL(rule.to, ORIGIN).pathname : target.pathname;
  const decoded = decodePath(path);
  const found = await autoTrailingSlash(decoded, assetsOf(root), NOT_FOUND[host.not_found_handling]);
  if (!found) return answer(404);
  if (!SAFE.includes(method.toUpperCase())) return answer(405);
  // one URL per asset: its path decoded, then encoded a segment at a time
  const canonical = encodePath(found.moved ?? decoded);
  if (found.moved || canonical !== path) {
    const location = canonical + target.search;
    return answer(307, [["location", location]], { location });
  }
  const type = TYPES[extname(found.file)] ?? "application/octet-stream";
  return answer(found.status, [["content-type", type]], { file: found.file });
};

// a page nucleus-ssr prerendered: `<html n-ssr>`, after the doctype
const PRERENDERED =
  /^\s*(?:<!doctype[^>]*>\s*)?<html(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*?\s+n-ssr(?=[\s=/>])/i;

/** Whether `body`, a file's bytes, is a prerendered page. */
const isPrerendered = (body) => PRERENDERED.test(body.subarray(0, 4096).toString());

const send = (res, status, headers, body) => {
  res.statusCode = status;
  for (const [name, value] of [...headers, ["cache-control", "no-store"]]) res.setHeader(name, value);
  res.end(body);
};

/**
 * `(req, res)` for the build in `root`, as the host answers it, never cached. The
 * rules are read per request, so a rebuild applies at once. Never rejects: a
 * failure is a 500, a response already begun is dropped. `shell` (bytes) answers
 * in place of every prerendered page, with its status and headers.
 */
export const hostHandler = (root, { shell } = {}) => {
  const respond = async (req, res) => {
    const { status, file, headers } = await answerOf(root, req);
    const body = status === 400 ? "Bad request" : file && req.method !== "HEAD" ? await readFile(file) : undefined;
    send(res, status, headers, shell && file && body && isPrerendered(body) ? shell : body);
  };
  return (req, res) =>
    respond(req, res).catch((error) =>
      res.headersSent
        ? res.destroy()
        : send(res, 500, [["content-type", TEXT]], `Server error: ${error?.message ?? error}`)
    );
};

/**
 * Serves the build in `root` as the host does, never cached, on every network
 * interface (`port` 0: any free port). `shell`: the file of the untouched shell
 * a prerendered page was rendered into (`nucleus-ssr --save-shell <file>`);
 * every request a prerendered page would answer gets it instead, to compare a
 * page with a cold render in a browser.
 */
export const serveSite = async ({ root, port = 0, shell }) => {
  const cold = shell
    ? await readFile(shell).catch(() => {
        throw new Error(`serveSite: no shell at ${shell} (prerender with \`nucleus-ssr --save-shell\` first)`);
      })
    : undefined;
  const server = createServer(hostHandler(root, { shell: cold }));
  await new Promise((ok, fail) => server.once("error", fail).listen(port, ok));
  return {
    port: server.address().port,
    close: () => (server.closeAllConnections(), server.close()),
  };
};
