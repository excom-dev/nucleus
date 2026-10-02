import { Server } from "node:http";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { answerOf, headersOf, hostHandler, hostOf, redirectsOf, rulesOf, serveSite } from "../../host.mjs";
import { makeTempDir, removeDir, writeFiles } from "../../../heft-rig/support/tests/docs-pipeline-fixtures";
import { makeRes, waitForFinish } from "../../../heft-rig/support/tests/helpers/vite-fixture";

const REDIRECTS = `
# comment
/shell        /shell.js   200
/sandbox/*    /sandbox    200
/old          /new        301
/query        /new?from=rule 308
/bare         /target
/away         https://example.com/x
/home         /about/     200
/spaced       /my%20page  200
/missing      /nowhere    200
/escape       /../outside.html 200
/rewrite404   /a/b        404
/proxy-out    https://example.com/ 200
/dbl          //elsewhere/x 301
/sandbox/fixed /about     200
/shell        /twice.js   200
`;

const HEADERS = `
# comment
/*
  Vary: Accept-Encoding
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=15552000

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/service-worker/*
  Cache-Control: no-store
  Service-Worker-Allowed: /
`;

/**
 * A built site: pages with and without a trailing slash (one with a space and one with a `#`
 * in its name), a page that is also a directory, a directory 404 page, a bare directory, an
 * extensionless file and the rules above.
 */
const SITE = {
  _redirects: REDIRECTS,
  _headers: HEADERS,
  "404.html": "<h1>not found</h1>",
  "index.html": "<h1>home</h1>",
  "a/b.html": "<h1>a b</h1>",
  "a/404.html": "<h1>a not found</h1>",
  "a#b.html": "<h1>a#b</h1>",
  "my page.html": "<h1>my page</h1>",
  "about.html": "<h1>about</h1>",
  "both.html": "<h1>both page</h1>",
  "both/index.html": "<h1>both index</h1>",
  "docs/index.html": "<h1>docs</h1>",
  "sandbox.html": "<h1>sandbox</h1>",
  "shell.js": "export {};",
  "assets/app.js": "export {};",
  "service-worker/service-worker.js": "// worker",
  "empty/.keep": "",
  LICENSE: "MIT",
};

/** The host's own settings for `dist` beside it. */
const wrangler = (assets: Record<string, string>) =>
  `// a comment with "quotes"\n{\n  "name": "site", /* block */\n  "assets": ${JSON.stringify({ directory: "./dist", ...assets })},\n}\n`;

let tmp: string;
let site: string;
let spa: string;
let none: string;
let bare: string;

beforeAll(() => {
  tmp = makeTempDir("vite-plugin-nucleus-host-");
  site = path.join(tmp, "site/dist");
  spa = path.join(tmp, "spa/dist");
  none = path.join(tmp, "none/dist");
  bare = path.join(tmp, "bare");
  writeFiles(path.join(tmp, "site"), { "wrangler.jsonc": wrangler({ not_found_handling: "404-page" }) });
  writeFiles(site, SITE);
  writeFiles(path.join(tmp, "spa"), { "wrangler.jsonc": wrangler({ not_found_handling: "single-page-application" }) });
  writeFiles(spa, { "index.html": "<h1>app</h1>", "404.html": "<h1>unused</h1>", "app.js": "export {};" });
  writeFiles(path.join(tmp, "none"), { "wrangler.jsonc": wrangler({ not_found_handling: "none" }) });
  writeFiles(none, { "index.html": "<h1>none</h1>", "404.html": "<h1>unused</h1>" });
  writeFiles(bare, { "index.html": "<h1>bare</h1>" });
  // beside the site: no request or rule reaches it
  writeFiles(path.join(tmp, "site"), { "outside.html": "<h1>outside</h1>", "secret.html": "<h1>secret</h1>" });
});

afterAll(() => removeDir(tmp));

describe("rules", () => {
  it("keeps the lines the host keeps, normalised as it stores them", () => {
    expect(redirectsOf(REDIRECTS).map(({ from, to, status }) => [from, to, status])).toEqual([
      ["/shell", "/shell.js", 200],
      ["/sandbox/*", "/sandbox", 200],
      ["/old", "/new", 301],
      ["/query", "/new?from=rule", 308],
      ["/bare", "/target", 302],
      ["/away", "https://example.com/x", 302],
      ["/home", "/about/", 200],
      ["/spaced", "/my%20page", 200],
      ["/missing", "/nowhere", 200],
      ["/escape", "/outside.html", 200],
      ["/dbl", "//elsewhere/x", 301],
      ["/sandbox/fixed", "/about", 200],
    ]);
  });

  it("drops what the host drops: a token count, a status, a host in `from`, a repeat, a loop, a 200 elsewhere", () => {
    const dropped = [
      "/only-from",
      "/a /b 302 extra",
      "/a /b 404",
      "/a /b nope",
      "https://example.com/a /b",
      "/a ftp://example.com/b",
      "/* /index.html",
      "/x/* /x/index 301",
      "/ /index 301",
      "/out https://example.com/ 200",
    ];
    expect(redirectsOf(dropped.join("\n"))).toEqual([]);
    expect(redirectsOf("/ /index 301", "none")).toEqual([{ from: "/", to: "/index", status: 301 }]);
    expect(redirectsOf("/a /b\n/a /c")).toEqual([{ from: "/a", to: "/b", status: 302 }]);
  });

  it("reads `#` after a space as a comment, and keeps `//a` as the host stores it", () => {
    expect(redirectsOf("/c1 /b # note\n/c2 /b#frag\n//from //to 301")).toEqual([
      { from: "/c1", to: "/b", status: 302 },
      { from: "/c2", to: "/b#frag", status: 302 },
      { from: "//from", to: "//to", status: 301 },
    ]);
  });

  it("reads a path line by its start, names lower-cased, a repeat joined, `! name` as removal", () => {
    expect(
      headersOf(
        "X-Orphan: 1\n/a\n  X-One: 1\n  x-one: 2\n  ! Vary\n  X-Empty:\n  Bad Name: 1\n  no separator\n" +
          "  /indented\n  Link: <https://a>; rel=preload\n/empty\n/a/*/*\n  X-Two: 2\n/b/*/:splat\n  X-Two: 2\n/a\n  X-Last: 1\n"
      )
    ).toEqual([
      { path: "/a", set: { "x-last": "1" }, unset: [] },
      { path: "/indented", set: { link: "<https://a>; rel=preload" }, unset: [] },
    ]);
    expect(headersOf("/a\n  X-One: 1\n  ! Vary")).toEqual([{ path: "/a", set: { "x-one": "1" }, unset: ["Vary"] }]);
    expect(() => headersOf("https://example.com/*\n  X: 1")).toThrow('"https://example.com/*" names a host');
  });

  it("matches lines without `*` or `:name` before the first that has one exactly, the rest in order", async () => {
    const rules = await rulesOf(site);
    expect(rules.redirect("/shell")).toEqual({ to: "/shell.js", status: 200 });
    expect(rules.redirect("/sandbox/cells-app")).toEqual({ to: "/sandbox", status: 200 });
    // after the first dynamic line: `/sandbox/*` comes first
    expect(rules.redirect("/sandbox/fixed")).toEqual({ to: "/sandbox", status: 200 });
    expect(rules.redirect("/anything")).toBeUndefined();
    expect((await rulesOf(bare)).redirect("/x")).toBeUndefined();
  });

  it("fills `:splat` and `:name` into the target, and collapses a relative target's slashes", async () => {
    const dir = path.join(tmp, "placeholders");
    writeFiles(dir, {
      _redirects:
        "/blog/* /news/:splat 301\n/blog/special /special 301\n/u/:id /user/:id 301\n/x/:a/:a /never\n/deep/* //deep//:splat 302\n/ext/* https://example.com//:splat 302\n",
    });
    const rules = await rulesOf(dir);
    expect(rules.redirect("/blog/special")).toEqual({ to: "/news/special", status: 301 });
    expect(rules.redirect("/blog/a/b")).toEqual({ to: "/news/a/b", status: 301 });
    expect(rules.redirect("/u/7")).toEqual({ to: "/user/7", status: 301 });
    expect(rules.redirect("/u/7/8")).toBeUndefined();
    expect(rules.redirect("/x/1/1")).toBeUndefined();
    expect(rules.redirect("/deep/a")).toEqual({ to: "/deep/a", status: 302 });
    expect(rules.redirect("/ext/a")).toEqual({ to: "https://example.com/a", status: 302 });
  });

  it("sends a `//host` target of an exact line to that host, and collapses it after a dynamic one", async () => {
    const dir = path.join(tmp, "double-slash");
    writeFiles(dir, { _redirects: "/s //elsewhere/x 301\n/d/* //elsewhere/:splat 301\n" });
    expect(await answerOf(dir, { url: "/s?q=1" })).toMatchObject({ status: 301, location: "https://elsewhere/x?q=1" });
    expect(await answerOf(dir, { url: "/d/y" })).toMatchObject({ status: 301, location: "/elsewhere/y" });
  });

  it("gives every matching block's sets and removals, in order, `:splat` filled in", async () => {
    const dir = path.join(tmp, "blocks");
    writeFiles(dir, { _headers: "/*\n  X-A: 1\n/files/*\n  X-File: :splat\n  ! X-A\n" });
    expect((await rulesOf(dir)).headers("/files/a/b")).toEqual([
      { set: [["x-a", "1"]], unset: [] },
      { set: [["x-file", "a/b"]], unset: ["X-A"] },
    ]);
  });
});

describe("hostOf", () => {
  it("reads the assets options of the wrangler.jsonc that serves the directory", async () => {
    expect(await hostOf(site)).toEqual({ not_found_handling: "404-page", html_handling: "auto-trailing-slash" });
    expect(await hostOf(spa)).toEqual({
      not_found_handling: "single-page-application",
      html_handling: "auto-trailing-slash",
    });
  });

  it("keeps the host's defaults without a config, or with one for another directory", async () => {
    const defaults = { not_found_handling: "none", html_handling: "auto-trailing-slash" };
    expect(await hostOf(bare)).toEqual(defaults);
    const other = path.join(tmp, "other");
    writeFiles(other, { "wrangler.jsonc": '{ "assets": { "directory": "./public", "not_found_handling": "404-page" } }', "dist/x": "" });
    expect(await hostOf(path.join(other, "dist"))).toEqual(defaults);
    writeFiles(other, { "wrangler.jsonc": '{ "name": "worker" }' });
    expect(await hostOf(path.join(other, "dist"))).toEqual(defaults);
  });

  it("reads a wrangler.json too, the nearest file first, wrangler.json before wrangler.jsonc beside it", async () => {
    const json = path.join(tmp, "json");
    writeFiles(json, { "wrangler.json": JSON.stringify({ assets: { directory: "./dist", not_found_handling: "404-page" } }), "dist/x": "" });
    expect(await hostOf(path.join(json, "dist"))).toEqual({ not_found_handling: "404-page", html_handling: "auto-trailing-slash" });
    writeFiles(json, { "wrangler.jsonc": wrangler({ not_found_handling: "single-page-application" }) });
    expect((await hostOf(path.join(json, "dist"))).not_found_handling).toBe("404-page");
    // a nearer file wins
    writeFiles(json, { "dist/wrangler.jsonc": '{ "assets": { "directory": ".", "not_found_handling": "single-page-application" } }' });
    expect((await hostOf(path.join(json, "dist"))).not_found_handling).toBe("single-page-application");
  });

  it("refuses a nearest wrangler.toml, naming it: its assets options are not read", async () => {
    // a wrangler.jsonc further up is not the one wrangler reads
    writeFiles(path.join(tmp, "toml-outer"), { "wrangler.jsonc": wrangler({}) });
    const toml = path.join(tmp, "toml-outer/toml");
    writeFiles(toml, { "wrangler.toml": '[assets]\ndirectory = "./dist"\n', "dist/x": "" });
    await expect(hostOf(path.join(toml, "dist"))).rejects.toThrow(
      `${path.join(toml, "wrangler.toml")}: the preview follows the assets options of a wrangler.jsonc or wrangler.json only`
    );
  });

  it("refuses a Worker script: main, or run_worker_first", async () => {
    const worker = path.join(tmp, "worker");
    writeFiles(worker, { "wrangler.jsonc": '{ "main": "src/index.js", "assets": { "directory": "./dist" } }', "dist/x": "" });
    await expect(hostOf(path.join(worker, "dist"))).rejects.toThrow("a Worker script (main, run_worker_first) is not emulated");
    writeFiles(worker, { "wrangler.jsonc": wrangler({ run_worker_first: true } as never) });
    await expect(hostOf(path.join(worker, "dist"))).rejects.toThrow("is not emulated");
  });

  it("refuses a setting it does not emulate", async () => {
    const odd = path.join(tmp, "odd");
    writeFiles(odd, { "wrangler.jsonc": wrangler({ html_handling: "drop-trailing-slash" }), "dist/x": "" });
    await expect(hostOf(path.join(odd, "dist"))).rejects.toThrow(
      'html_handling "drop-trailing-slash" is not emulated (auto-trailing-slash)'
    );
    writeFiles(odd, { "wrangler.jsonc": wrangler({ not_found_handling: "spa" }) });
    await expect(hostOf(path.join(odd, "dist"))).rejects.toThrow('not_found_handling "spa" is not emulated');
  });
});

type Row = [url: string, status: number, detail?: string];

/**
 * What the `404-page` site answers: the file served, or where a 3xx sends it. `auto-trailing-slash`:
 * a page at its slashless URL, a directory index at its slashed one, any other spelling moved there.
 */
const ANSWERS: Row[] = [
  ["/", 200, "index.html"],
  ["/?utm=1", 200, "index.html"],
  ["/index.html", 307, "/"],
  ["/index", 307, "/"],
  ["/a/b", 200, "a/b.html"],
  ["/a/b.html", 307, "/a/b"],
  ["/a/b/", 307, "/a/b"],
  ["/a/b/index", 307, "/a/b"],
  ["/a/b/index.html", 307, "/a/b"],
  ["/a/b/?x=1&y=2", 307, "/a/b?x=1&y=2"],
  ["/a/b%2F", 307, "/a/b"],
  ["/a//b/", 307, "/a/b"],
  ["/%2Fa%2Fb%2F", 307, "/a/b"],
  ["/my%20page", 200, "my page.html"],
  ["/my%20page/", 307, "/my%20page"],
  ["/a%23b", 200, "a#b.html"],
  ["/about", 200, "about.html"],
  ["/both", 200, "both.html"],
  ["/both/", 200, "both/index.html"],
  ["/docs", 307, "/docs/"],
  ["/docs/", 200, "docs/index.html"],
  ["/docs/index.html", 307, "/docs/"],
  ["/docs.html", 307, "/docs/"],
  ["/sandbox.html", 307, "/sandbox"],
  ["/LICENSE", 200, "LICENSE"],
  ["/assets/app.js", 200, "assets/app.js"],
  // `_redirects`
  ["/shell", 200, "shell.js"],
  ["/sandbox/cells-app", 200, "sandbox.html"],
  ["/sandbox/fixed", 200, "sandbox.html"],
  ["/spaced", 200, "my page.html"],
  ["/home", 307, "/about"],
  ["/old?x=1", 301, "/new?x=1"],
  ["/query?x=1", 308, "/new?from=rule"],
  ["/bare", 302, "/target"],
  ["/away?q=1", 302, "https://example.com/x?q=1"],
  // after a dynamic line, a target's `//` collapses
  ["/dbl", 301, "/elsewhere/x"],
  // not found: the nearest 404.html, with a 404
  ["/missing", 404, "404.html"],
  ["/escape", 404, "404.html"],
  ["/rewrite404", 404, "404.html"],
  ["/proxy-out", 404, "404.html"],
  ["/empty", 404, "404.html"],
  ["/empty/", 404, "404.html"],
  ["/a/", 404, "a/404.html"],
  ["/a/missing", 404, "a/404.html"],
  ["/a/b/c", 404, "a/404.html"],
  ["/_headers", 404, "404.html"],
  ["/_redirects", 404, "404.html"],
  ["/secret.html", 404, "404.html"],
  ["http://h/../../../secret/", 404, "404.html"],
  // a path the host would not spell so, even unknown, moves to its one spelling first
  ["/%E0%A4%A", 307, "/%25E0%25A4%25A"],
  ["/%25E0%25A4%25A", 404, "404.html"],
  ["/..%2F..%2Fsecret.html", 307, "/../../secret.html"],
];

const answer = async (root: string, url: string, method = "GET") => {
  const { status, file, location } = await answerOf(root, { url, method });
  return [status, file ? path.relative(root, file) : location];
};

describe("answerOf", () => {
  it.each(ANSWERS)("%s: %i %s", async (url, status, detail) => {
    expect(await answer(site, url)).toEqual([status, detail]);
  });

  it("refuses a target that is not a path of the site", async () => {
    for (const url of ["//", "//nucleus/docs/x/", "/\\nucleus/docs/x/", "///x", "http://[bad"])
      expect(await answerOf(site, { url })).toEqual({ status: 400, headers: [["content-type", "text/plain; charset=utf-8"]] });
  });

  it("sends the asset's headers, then the _headers of the requested path, on every answer", async () => {
    const worker = await answerOf(site, { url: "/service-worker/service-worker.js" });
    expect(worker.headers).toEqual([
      ["content-type", "text/javascript; charset=utf-8"],
      ["vary", "Accept-Encoding"],
      ["x-frame-options", "SAMEORIGIN"],
      ["service-worker-allowed", "/"],
    ]);
    expect((await answerOf(site, { url: "/a/b/" })).headers).toEqual([
      ["location", "/a/b"],
      ["vary", "Accept-Encoding"],
      ["x-frame-options", "SAMEORIGIN"],
    ]);
  });

  it("lets _headers replace an asset's own header, remove one, and add to a repeated name", async () => {
    const dir = path.join(tmp, "own");
    writeFiles(dir, {
      "wrangler.jsonc": wrangler({}),
      "dist/notes.txt": "notes",
      "dist/_headers":
        "/*\n  Link: </a.css>; rel=preload\n  X-Frame-Options: DENY\n/notes.txt\n  Content-Type: text/markdown\n  Link: </b.css>; rel=preload\n  ! X-Frame-Options\n",
    });
    expect((await answerOf(path.join(dir, "dist"), { url: "/notes.txt" })).headers).toEqual([
      ["content-type", "text/markdown"],
      ["link", "</a.css>; rel=preload, </b.css>; rel=preload"],
    ]);
  });

  it("matches names exactly, letter case included, as the host's manifest does", async () => {
    const dir = path.join(tmp, "case");
    writeFiles(dir, { "a/b.html": "<h1>b</h1>", "c.txt": "c" });
    for (const url of ["/A/b", "/a/B", "/C.txt", "/a/b.HTML"]) expect(await answer(dir, url), url).toEqual([404, undefined]);
    expect(await answer(dir, "/a/b")).toEqual([200, "a/b.html"]);
  });

  it("answers a 500 for a _headers rule it does not emulate", async () => {
    const dir = path.join(tmp, "host-rule");
    writeFiles(dir, { "index.html": "", _headers: "https://example.com/*\n  X: 1\n" });
    const res = makeRes();
    await hostHandler(dir)({ url: "/" }, res);
    expect([res.statusCode, res.body]).toEqual([500, 'Server error: _headers: "https://example.com/*" names a host, which is not emulated']);
  });

  it("answers what is not a GET or HEAD with a 405, once something answers the path", async () => {
    expect(await answer(site, "/a/b", "POST")).toEqual([405, undefined]);
    expect(await answer(site, "/a/b", "head")).toEqual([200, "a/b.html"]);
    expect(await answer(none, "/nope", "POST")).toEqual([404, undefined]);
  });

  it("single-page-application: every unknown path, /api/* too, answers index.html", async () => {
    expect(await answer(spa, "/shop/seating")).toEqual([200, "index.html"]);
    expect(await answer(spa, "/api/me")).toEqual([200, "index.html"]);
    expect(await answer(spa, "/missing.js")).toEqual([200, "index.html"]);
    expect(await answer(spa, "/app.js")).toEqual([200, "app.js"]);
    expect(await answer(spa, "/404")).toEqual([200, "404.html"]);
    const empty = path.join(tmp, "spa-empty");
    writeFiles(empty, { "wrangler.jsonc": wrangler({ not_found_handling: "single-page-application" }), "dist/a.js": "" });
    expect(await answer(path.join(empty, "dist"), "/x")).toEqual([404, undefined]);
  });

  it("404-page without any 404.html: a bare 404", async () => {
    const lost = path.join(tmp, "lost");
    writeFiles(lost, { "wrangler.jsonc": wrangler({ not_found_handling: "404-page" }), "dist/a/b.html": "" });
    expect(await answer(path.join(lost, "dist"), "/a/missing")).toEqual([404, undefined]);
  });

  it("none: an unknown path is a bare 404, a 404.html unused", async () => {
    expect(await answer(none, "/missing")).toEqual([404, undefined]);
    expect(await answer(none, "/")).toEqual([200, "index.html"]);
    expect(await answer(bare, "/missing")).toEqual([404, undefined]);
  });
});

describe("hostHandler", () => {
  const request = async (root: string, url: string, method?: string) => {
    const res = makeRes();
    await hostHandler(root)({ url, method }, res);
    return res;
  };

  it("serves a file typed by its extension, never cached, without the headers a local server leaves out", async () => {
    const page = await request(site, "/a/b");
    expect([page.statusCode, page.body, page.headers["content-type"], page.headers["cache-control"]]).toEqual([
      200,
      "<h1>a b</h1>",
      "text/html; charset=utf-8",
      "no-store",
    ]);
    expect(page.headers["strict-transport-security"]).toBeUndefined();
    expect(page.headers.vary).toBe("Accept-Encoding");
    expect((await request(site, "/assets/app.js")).headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect((await request(site, "/LICENSE")).headers["content-type"]).toBe("application/octet-stream");
  });

  it("types what a static site serves as the host does: modules, data, images, fonts, media", async () => {
    const dir = path.join(tmp, "typed");
    const types = {
      "lib.mjs": "text/javascript; charset=utf-8",
      "data.json": "application/json",
      "app.js.map": "application/json",
      "app.wasm": "application/wasm",
      "a.jpg": "image/jpeg",
      "a.avif": "image/avif",
      "a.gif": "image/gif",
      "favicon.ico": "image/vnd.microsoft.icon",
      "font.woff2": "font/woff2",
      "clip.mp4": "video/mp4",
      "sound.mp3": "audio/mpeg",
      "doc.pdf": "application/pdf",
      "table.csv": "text/csv; charset=utf-8",
    };
    writeFiles(dir, Object.fromEntries(Object.keys(types).map((file) => [file, "x"])));
    for (const [file, type] of Object.entries(types)) expect((await request(dir, `/${file}`)).headers["content-type"], file).toBe(type);
  });

  it("answers HEAD without a body", async () => {
    const head = await request(site, "/a/b", "HEAD");
    expect([head.statusCode, head.body, head.headers["content-type"]]).toEqual([200, "", "text/html; charset=utf-8"]);
  });

  it("moves with a Location and no body, and answers a 404 page with its status", async () => {
    const moved = await request(site, "/a/b/?x=1");
    expect([moved.statusCode, moved.headers.location, moved.body]).toEqual([307, "/a/b?x=1", ""]);
    const missing = await request(site, "/nope");
    expect([missing.statusCode, missing.body, missing.headers["content-type"]]).toEqual([
      404,
      "<h1>not found</h1>",
      "text/html; charset=utf-8",
    ]);
    const bareMissing = await request(bare, "/nope");
    expect([bareMissing.statusCode, bareMissing.body, bareMissing.headers["content-type"]]).toEqual([404, "", undefined]);
  });

  it("answers an unreadable target with a 400", async () => {
    const res = await request(site, "//");
    expect([res.statusCode, res.headers["content-type"], res.body]).toEqual([
      400,
      "text/plain; charset=utf-8",
      "Bad request",
    ]);
  });

  it("never rejects: a failure is a 500, and a response already begun is dropped", async () => {
    const failing = (headersSent: boolean, thrown: unknown = new Error("Invalid header name")) => {
      const res = Object.assign(makeRes(), { headersSent, destroy: vi.fn() });
      const setHeader = res.setHeader;
      let failed = false;
      res.setHeader = (name, value) => {
        if (!failed) {
          failed = true;
          throw thrown;
        }
        setHeader(name, value);
      };
      return res;
    };
    const handle = hostHandler(site);
    const failed = failing(false);
    await expect(handle({ url: "/a/b" }, failed)).resolves.toBeUndefined();
    expect([failed.statusCode, failed.body]).toEqual([500, "Server error: Invalid header name"]);
    const odd = failing(false, "not an Error");
    await handle({ url: "/a/b" }, odd);
    expect(odd.body).toBe("Server error: not an Error");
    const begun = failing(true);
    await handle({ url: "/a/b" }, begun);
    expect([begun.destroy.mock.calls.length, begun.ended]).toEqual([1, false]);
  });
});

describe("hostHandler with a shell", () => {
  // a prerendered site: its pages carry `<html n-ssr>`, a non-prerendered one does not
  const PAGE = (html: string) => `<!DOCTYPE html>${html}<head><title>t</title></head><body>page</body></html>`;
  const SHELL = Buffer.from("<!doctype html><html><body>shell</body></html>");
  let cold: string;

  beforeAll(() => {
    cold = path.join(tmp, "cold/dist");
    writeFiles(path.join(tmp, "cold"), { "wrangler.jsonc": wrangler({ not_found_handling: "404-page" }) });
    writeFiles(cold, {
      "index.html": PAGE(`<html lang="en" n-ssr="">`),
      "menu.html": PAGE(`<html n-ssr>`),
      "quoted.html": PAGE(`<html data-x="a>b" n-ssr="">`),
      "other.html": PAGE(`<html n-ssr-x="" data-n-ssr="">`),
      "sandbox.html": PAGE(`<html lang="en">`),
      "404.html": PAGE(`<html lang="en" n-ssr="">`),
      "app.js": "export {};",
    });
  });

  const request = async (url: string, method?: string) => {
    const res = makeRes();
    await hostHandler(cold, { shell: SHELL })({ url, method }, res);
    return [res.statusCode, res.body, res.headers["content-type"]];
  };

  it("answers a prerendered page with the shell, its status and headers kept", async () => {
    const html = "text/html; charset=utf-8";
    expect(await request("/")).toEqual([200, SHELL.toString(), html]);
    expect(await request("/menu")).toEqual([200, SHELL.toString(), html]);
    expect(await request("/quoted")).toEqual([200, SHELL.toString(), html]);
    expect(await request("/nowhere")).toEqual([404, SHELL.toString(), html]);
  });

  it("answers everything else as usual: a page that is not prerendered, an asset, a move, a HEAD", async () => {
    expect(await request("/sandbox")).toEqual([200, PAGE(`<html lang="en">`), "text/html; charset=utf-8"]);
    expect((await request("/other"))[1]).toBe(PAGE(`<html n-ssr-x="" data-n-ssr="">`));
    expect(await request("/app.js")).toEqual([200, "export {};", "text/javascript; charset=utf-8"]);
    expect((await request("/menu.html"))[0]).toBe(307);
    expect((await request("/menu", "HEAD"))[1]).toBe("");
  });
});

describe("serveSite", () => {
  // binding a port is denied in some sandboxes: stub `listen` and drive the server by hand
  let listening: { server: Server; port: number } | undefined;
  const stubListen = (error?: Error) => {
    listening = undefined;
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server, port: number, done: () => void) {
      listening = { server: this, port };
      if (error) queueMicrotask(() => this.emit("error", error));
      else done();
      return this;
    } as never);
  };

  afterEach(() => vi.restoreAllMocks());

  it("serves the site on the port it listens on, until closed", async () => {
    stubListen();
    vi.spyOn(Server.prototype, "address").mockReturnValue({ port: 4321 } as never);
    const dropConnections = vi.spyOn(Server.prototype, "closeAllConnections").mockImplementation(() => {});
    const close = vi.spyOn(Server.prototype, "close").mockImplementation(function (this: Server) {
      return this;
    } as never);

    const served = await serveSite({ root: site });
    expect([served.port, listening?.port]).toEqual([4321, 0]);
    const res = makeRes();
    listening!.server.emit("request", { url: "/a/b" }, res);
    await waitForFinish(res);
    expect([res.statusCode, res.body]).toEqual([200, "<h1>a b</h1>"]);
    served.close();
    expect([dropConnections, close].map((spy) => spy.mock.calls.length)).toEqual([1, 1]);
  });

  it("serves a shell file in place of prerendered pages, and names a missing one", async () => {
    stubListen();
    vi.spyOn(Server.prototype, "address").mockReturnValue({ port: 4322 } as never);
    writeFiles(tmp, {
      "shelled/dist/index.html": `<html lang="en" n-ssr=""><body>home</body></html>`,
      "shelled/temp/prerender-shell.html": "<html><body>shell</body></html>",
    });
    const root = path.join(tmp, "shelled/dist");
    await serveSite({ root, shell: path.join(tmp, "shelled/temp/prerender-shell.html") });
    const res = makeRes();
    listening!.server.emit("request", { url: "/" }, res);
    await waitForFinish(res);
    expect([res.statusCode, res.body]).toEqual([200, "<html><body>shell</body></html>"]);
    const missing = path.join(tmp, "shelled/temp/none.html");
    await expect(serveSite({ root, shell: missing })).rejects.toThrow(
      `serveSite: no shell at ${missing} (prerender with \`nucleus-ssr --save-shell\` first)`
    );
  });

  it("is given the port to listen on, and rejects when it cannot", async () => {
    stubListen(new Error("EADDRINUSE"));
    await expect(serveSite({ root: site, port: 4173 })).rejects.toThrow("EADDRINUSE");
    expect(listening?.port).toBe(4173);
  });
});
