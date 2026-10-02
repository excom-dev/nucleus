import { Server } from "node:http";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  answerOf,
  headersOf,
  pagesHandler,
  pagesMiddleware,
  pathMatcher,
  rewritesOf,
  rulesOf,
  servePages,
} from "../../scripts/pages.mjs";
import { createRigViteConfig } from "../../scripts/vite-config.mjs";
import { makeTempDir, removeDir, writeFiles } from "./docs-pipeline-fixtures";
import {
  makeReq,
  makeRes,
  makeServer,
  runMiddlewares,
  waitForFinish,
  type FakeRes,
  type FakeServer,
} from "./helpers/vite-fixture";

const REDIRECTS = `
# comment
/shell        /shell.js   200
/sandbox/*    /sandbox    200
/old          /new        301
/bare         /target
`;

const HEADERS = `
# comment
/*
  Vary: Accept-Encoding
  X-Frame-Options: SAMEORIGIN

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/service-worker/*
  Cache-Control: no-store
  Service-Worker-Allowed: /
`;

/** What the real `_headers` carries too, and a local server must not send. */
const HSTS = `
/*
  Strict-Transport-Security: max-age=15552000
`;

/** A header named in several blocks, and again with another spelling. */
const REPEATED = `
/*
  Strict-Transport-Security: max-age=15552000
  Link: </a.css>; rel=preload
  vary: Origin

/x/*
  Link: </b.css>; rel=preload
  Link: </c.css>; rel=preload
  Vary: Accept-Encoding
  STRICT-TRANSPORT-SECURITY: max-age=1
`;

/**
 * A built site: slashless pages (one with a space and one with a `#` in its name), a page
 * directory, a page that is also a directory, a bare directory, an extensionless file, and a
 * rule that sends `/home` to the slashed `/about/`.
 */
const SITE = {
  _redirects: `${REDIRECTS}/home /about/ 200\n/spaced /my%20page 200\n`,
  _headers: HEADERS + HSTS,
  "404.html": "<h1>not found</h1>",
  "index.html": "<h1>home</h1>",
  "a/b.html": "<h1>a b</h1>",
  "a#b.html": "<h1>a#b</h1>",
  "my page.html": "<h1>my page</h1>",
  "about.html": "<h1>about</h1>",
  "both.html": "<h1>both page</h1>",
  "both/index.html": "<h1>both index</h1>",
  "docs/index.html": "<h1>docs</h1>",
  "nucleus/docs/x.html": "<h1>x</h1>",
  "sandbox.html": "<h1>sandbox</h1>",
  "shell.js": "export {};",
  "assets/app.js": "export {};",
  "service-worker/service-worker.js": "// worker",
  "empty/.keep": "",
  LICENSE: "MIT",
};

let tmp: string;
let site: string;
let bare: string;
let rulesOnly: string;
let spelled: string;
let repeated: string;
let escape: string;
let slashed: string;
let pkg: string;

beforeAll(() => {
  tmp = makeTempDir("heft-rig-pages-");
  [site, bare, rulesOnly, spelled, repeated, escape, slashed, pkg] = [
    "site",
    "bare",
    "rules-only",
    "spelled",
    "repeated",
    "escape",
    "slashed",
    "pkg",
  ].map((name) => path.join(tmp, name));
  writeFiles(site, SITE);
  writeFiles(bare, { "index.html": "<h1>bare</h1>" });
  writeFiles(rulesOnly, { _redirects: REDIRECTS, _headers: HEADERS });
  writeFiles(spelled, { _headers: "/*\n  cache-control: max-age=1\n  CACHE-CONTROL: max-age=2\n  X-A: 1\n" });
  writeFiles(repeated, { _headers: REPEATED });
  // a rule that climbs out of the site, and files beside the site folders that it and a request could reach
  writeFiles(escape, { _redirects: "/escape ../outside 200\n", "404.html": "<h1>not found</h1>" });
  writeFiles(tmp, { "outside.html": "<h1>outside</h1>", "secret.html": "<h1>secret</h1>" });
  // `docs.html` is the page and a rule sends `/home` to `/docs/`
  writeFiles(slashed, {
    _redirects: "/home /docs/ 200\n",
    "docs.html": "<h1>docs</h1>",
    "404.html": "<h1>not found</h1>",
  });
  // a package being previewed: the site is its `dist`
  writeFiles(path.join(pkg, "dist"), SITE);
});

afterAll(() => removeDir(tmp));

type Kind = "file" | "moved" | "none" | "unreadable";

const row = (url: string, kind: Kind, detail = "", note = "") => ({ url, kind, detail, note });

/**
 * What `site` answers for each URL, whoever asks: the `file` that serves it, the URL it is
 * `moved` to, `none`, or a target `unreadable`. The handler and the middleware are both held to it.
 */
const ANSWERS = [
  row("/", "file", "index.html"),
  row("/?utm=1", "file", "index.html"),
  row("/a/b", "file", "a/b.html"),
  row("/a/b/", "moved", "/a/b", "the page's one URL"),
  row("/a/b/?x=1&y=2", "moved", "/a/b?x=1&y=2", "the query goes with it"),
  row("/a/b%2F", "moved", "/a/b", "an encoded slash is the page's slash, not part of its name"),
  row("/a//b/", "moved", "/a/b", "built from the normalized page path"),
  row("/%2Fa%2Fb%2F", "moved", "/a/b", "decodes to `//a/b/`: never a `//` Location"),
  row("/nucleus//docs/x/", "moved", "/nucleus/docs/x"),
  row("/my%20page/", "moved", "/my%20page", "re-encoded"),
  row("/a%23b/", "moved", "/a%23b", "a `#` stays in the path"),
  row("/my%20page", "file", "my page.html"),
  row("/spaced", "file", "my page.html", "a rule's target is a URL: decoded like a request path"),
  row("/about", "file", "about.html"),
  row("/about/", "moved", "/about"),
  row("/home", "file", "about.html", "a rule sent it to `/about/`: served there, not moved to `/hom`"),
  row("/both", "file", "both.html"),
  row("/both/", "file", "both/index.html", "the directory index beats the page for a slash"),
  row("/docs", "file", "docs/index.html"),
  row("/docs/", "file", "docs/index.html"),
  row("/sandbox/cells-app", "file", "sandbox.html", "rewritten"),
  row("/shell", "file", "shell.js", "rewritten"),
  row("/LICENSE", "file", "LICENSE"),
  row("/empty", "none", "", "a directory is not a page"),
  row("/empty/", "none"),
  row("/nucleus/no-such-page", "none"),
  row("/%E0%A4%A", "none", "", "malformed escape"),
  row(
    "http://h/../../../secret/",
    "none",
    "",
    "absolute form climbing out: `secret.html` above the site is not looked at"
  ),
  row("//", "unreadable"),
  row("//nucleus/docs/x/", "unreadable", "", "a network path (host `nucleus`), not a path: no open redirect"),
  row("/\\nucleus/docs/x/", "unreadable", "", "a backslash reads as a slash"),
  row("///nucleus/docs/x/", "unreadable"),
];

describe("pathMatcher", () => {
  it("matches `*` as anything, including `/` itself", () => {
    const test = pathMatcher("/a/*");
    expect(["/a/", "/a/b", "/a/b/c"].map((path) => test.test(path))).toEqual([true, true, true]);
    expect(["/a", "/ab", "/x/a/b"].map((path) => test.test(path))).toEqual([false, false, false]);
    expect(pathMatcher("/*.md").test("/docs/x.md")).toBe(true);
    expect(pathMatcher("/*.md").test("/docs/x.mdx")).toBe(false);
  });

  it("takes every other character literally", () => {
    expect(pathMatcher("/a.b").test("/axb")).toBe(false);
    expect(pathMatcher("/a.b").test("/a.b")).toBe(true);
    expect(pathMatcher("/a(b)+").test("/a(b)+")).toBe(true);
    expect(pathMatcher("/").test("/")).toBe(true);
    expect(pathMatcher("/").test("/a")).toBe(false);
  });
});

describe("rewritesOf", () => {
  it("keeps the `from to 200` lines, not comments, blanks or other statuses", () => {
    const rewrites = rewritesOf(REDIRECTS);
    expect(rewrites.map(([, to]) => to)).toEqual(["/shell.js", "/sandbox"]);
    expect(rewrites[0][0].test("/shell")).toBe(true);
    expect(rewrites[1][0].test("/sandbox/cells-app")).toBe(true);
    expect(rewritesOf("")).toEqual([]);
  });
});

describe("headersOf", () => {
  it("groups indented headers under the path line above them", () => {
    const blocks = headersOf(HEADERS);
    expect(blocks).toHaveLength(3);
    expect(blocks.map(([test]) => test.test("/assets/app.js"))).toEqual([true, true, false]);
    expect(blocks.map(([, pairs]) => pairs)).toEqual([
      [
        ["Vary", "Accept-Encoding"],
        ["X-Frame-Options", "SAMEORIGIN"],
      ],
      [["Cache-Control", "public, max-age=31536000, immutable"]],
      [
        ["Cache-Control", "no-store"],
        ["Service-Worker-Allowed", "/"],
      ],
    ]);
  });

  it("keeps the colons of a value, and drops a header with no path above it", () => {
    const [block] = headersOf("  Orphan: 1\n/x\n  Link: <https://cdn.example/a>; rel=preload\n");
    expect(block[1]).toEqual([["Link", "<https://cdn.example/a>; rel=preload"]]);
    expect(headersOf("  Orphan: 1\n")).toEqual([]);
  });
});

describe("rulesOf", () => {
  it("answers a path with its rewrite and its headers from every matching block", async () => {
    const rules = await rulesOf(site);
    expect(rules.rewrite("/sandbox/cells-app")).toBe("/sandbox");
    expect(rules.rewrite("/a/b")).toBeUndefined();
    expect(rules.headers("/service-worker/service-worker.js")).toEqual([
      ["Vary", "Accept-Encoding"],
      ["X-Frame-Options", "SAMEORIGIN"],
      ["Service-Worker-Allowed", "/"],
    ]);
  });

  it("leaves Cache-Control out, however it is spelled", async () => {
    const rules = await rulesOf(site);
    expect(rules.headers("/assets/app.js")).toEqual([
      ["Vary", "Accept-Encoding"],
      ["X-Frame-Options", "SAMEORIGIN"],
    ]);
    expect((await rulesOf(spelled)).headers("/x")).toEqual([["X-A", "1"]]);
  });

  it("leaves Strict-Transport-Security out, however it is spelled", async () => {
    const names = (await rulesOf(site)).headers("/a/b").map(([name]) => name.toLowerCase());
    expect(names).not.toContain("strict-transport-security");
    expect((await rulesOf(repeated)).headers("/x/y").map(([name]) => name)).not.toContain("STRICT-TRANSPORT-SECURITY");
  });

  it("joins the values of a header named in several blocks with `, `, under its first spelling", async () => {
    const rules = await rulesOf(repeated);
    expect(rules.headers("/x/y")).toEqual([
      ["Link", "</a.css>; rel=preload, </b.css>; rel=preload, </c.css>; rel=preload"],
      ["vary", "Origin, Accept-Encoding"],
    ]);
    expect(rules.headers("/other")).toEqual([
      ["Link", "</a.css>; rel=preload"],
      ["vary", "Origin"],
    ]);
  });

  it("has no rules for a site without the files", async () => {
    const rules = await rulesOf(bare);
    expect(rules.rewrite("/sandbox/x")).toBeUndefined();
    expect(rules.headers("/x")).toEqual([]);
  });
});

describe("answerOf", () => {
  const answer = (pathname: string, rewritten = false) => answerOf(site, { path: pathname, rewritten });
  const file = (name: string) => ({ file: path.join(site, name) });

  it("answers the file that serves a path: the path itself, its .html or its index", async () => {
    expect(await answer("/")).toEqual(file("index.html"));
    expect(await answer("/LICENSE")).toEqual(file("LICENSE"));
    expect(await answer("/a/b")).toEqual(file("a/b.html"));
    expect(await answer("/docs")).toEqual(file("docs/index.html"));
    expect(await answer("/docs/")).toEqual(file("docs/index.html"));
  });

  it("prefers the page for a slashless path, and the directory index for a slash", async () => {
    expect(await answer("/both")).toEqual(file("both.html"));
    expect(await answer("/both/")).toEqual(file("both/index.html"));
  });

  it("moves a slashed path to the page's one URL, unless a rule sent it there", async () => {
    expect(await answer("/a/b/")).toEqual({ moved: "/a/b" });
    expect(await answer("/a/b/", true)).toEqual(file("a/b.html"));
    expect(await answer("/a//b//")).toEqual({ moved: "/a/b" });
  });

  it("encodes the URL it moves to, a segment at a time", async () => {
    expect(await answer("/my page/")).toEqual({ moved: "/my%20page" });
    expect(await answer("/a#b/")).toEqual({ moved: "/a%23b" });
  });

  it("answers nothing for a directory or a missing path", async () => {
    for (const missing of ["/empty", "/empty/", "/nope", "/nope/"]) expect(await answer(missing)).toEqual({});
  });

  it("never looks at a file outside the site", async () => {
    // `outside.html` and `secret.html` sit beside the site folders
    const climbing = (pathname: string, rewritten = false) => answerOf(escape, { path: pathname, rewritten });
    for (const url of ["../outside", "a/../../outside", "../../secret/", "../outside/index"]) {
      expect([url, await climbing(url), await climbing(url, true)]).toEqual([url, {}, {}]);
    }
    // from the root, `..` has nowhere to go: the path lands inside the site, which has no such page
    expect(await answer("/../../secret")).toEqual({});
  });
});

describe("pagesHandler", () => {
  const request = async (handle: (req: object, res: object) => Promise<void>, url: string) => {
    const res = makeRes();
    await handle({ url }, res);
    return res;
  };

  it("serves a slashless page from its .html file, and / from index.html", async () => {
    const handle = await pagesHandler(site);
    const page = await request(handle, "/a/b");
    expect([page.statusCode, page.body, page.headers["content-type"]]).toEqual([
      200,
      "<h1>a b</h1>",
      "text/html; charset=utf-8",
    ]);
    const home = await request(handle, "/?utm=1");
    expect([home.statusCode, home.body]).toEqual([200, "<h1>home</h1>"]);
  });

  it("serves a file as it is, typed by its extension", async () => {
    const handle = await pagesHandler(site);
    const script = await request(handle, "/assets/app.js");
    expect([script.statusCode, script.headers["content-type"]]).toEqual([200, "text/javascript; charset=utf-8"]);
    const license = await request(handle, "/LICENSE");
    expect([license.body, license.headers["content-type"]]).toEqual(["MIT", "application/octet-stream"]);
  });

  it("serves the target of a 200 rewrite with a *", async () => {
    const handle = await pagesHandler(site);
    const sandbox = await request(handle, "/sandbox/cells-app");
    expect([sandbox.statusCode, sandbox.body]).toEqual([200, "<h1>sandbox</h1>"]);
    expect((await request(handle, "/shell")).body).toBe("export {};");
  });

  it("merges the headers of every matching block", async () => {
    const handle = await pagesHandler(site);
    const worker = await request(handle, "/service-worker/service-worker.js");
    expect(worker.headers).toMatchObject({
      vary: "Accept-Encoding",
      "x-frame-options": "SAMEORIGIN",
      "service-worker-allowed": "/",
    });
  });

  it("never lets a block's Cache-Control through", async () => {
    const handle = await pagesHandler(site);
    expect((await request(handle, "/assets/app.js")).headers["cache-control"]).toBe("no-store");
    expect((await request(handle, "/service-worker/service-worker.js")).headers["cache-control"]).toBe("no-store");
  });

  it("never sends Strict-Transport-Security, and joins a header named in several blocks", async () => {
    const handle = await pagesHandler(repeated);
    const res = await request(handle, "/x/y");
    expect(res.headers).toMatchObject({
      link: "</a.css>; rel=preload, </b.css>; rel=preload, </c.css>; rel=preload",
      vary: "Origin, Accept-Encoding",
    });
    expect(res.headers["strict-transport-security"]).toBeUndefined();
    expect((await request(await pagesHandler(site), "/a/b")).headers["strict-transport-security"]).toBeUndefined();
  });

  it("answers an unknown path with 404.html and a 404, headers included", async () => {
    const handle = await pagesHandler(site);
    const missing = await request(handle, "/nucleus/no-such-page");
    expect([missing.statusCode, missing.body, missing.headers["content-type"]]).toEqual([
      404,
      "<h1>not found</h1>",
      "text/html; charset=utf-8",
    ]);
    expect(missing.headers).toMatchObject({ vary: "Accept-Encoding", "cache-control": "no-store" });
  });

  it("answers a directory, and a malformed escape, with the 404", async () => {
    const handle = await pagesHandler(site);
    expect((await request(handle, "/empty")).statusCode).toBe(404);
    expect((await request(handle, "/%E0%A4%A")).statusCode).toBe(404);
  });

  const asked: Record<Kind, (res: FakeRes, detail: string) => void> = {
    file: (res, detail) => expect([res.statusCode, res.body]).toEqual([200, SITE[detail as keyof typeof SITE]]),
    moved: (res, detail) =>
      // a 308 is cached for good unless told not to
      expect([res.statusCode, res.headers.location, res.headers["cache-control"], res.body]).toEqual([
        308,
        detail,
        "no-store",
        "",
      ]),
    none: (res) => expect([res.statusCode, res.body]).toEqual([404, SITE["404.html"]]),
    unreadable: (res) =>
      expect([res.statusCode, res.headers["content-type"], res.body]).toEqual([
        400,
        "text/plain; charset=utf-8",
        "Bad request",
      ]),
  };

  it.each(ANSWERS)("$url: $kind $detail $note", async ({ url, kind, detail }) => {
    asked[kind](await request(await pagesHandler(site), url), detail);
  });

  it("answers a rewrite that climbs out of the site with the 404, not the file above it", async () => {
    const res = await request(await pagesHandler(escape), "/escape");
    expect([res.statusCode, res.body]).toEqual([404, "<h1>not found</h1>"]);
  });

  it("serves what a rule sent to a slashed page, and moves only the slashed URL itself", async () => {
    const handle = await pagesHandler(slashed);
    const home = await request(handle, "/home");
    expect([home.statusCode, home.body, home.headers.location]).toEqual([200, "<h1>docs</h1>", undefined]);
    const docs = await request(handle, "/docs/");
    expect([docs.statusCode, docs.headers.location]).toEqual([308, "/docs"]);
  });

  it("answers an unknown path of a site without 404.html in plain text", async () => {
    const res = await request(await pagesHandler(bare), "/nope");
    expect([res.statusCode, res.headers["content-type"], res.body]).toEqual([
      404,
      "text/plain; charset=utf-8",
      "Not found",
    ]);
  });

  it("never rejects: a failure is a 500, and a response already begun is dropped", async () => {
    const handle = await pagesHandler(site);
    // the first header it sets fails
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
    const failed = failing(false);
    await expect(handle({ url: "/a/b" }, failed)).resolves.toBeUndefined();
    expect([failed.statusCode, failed.headers["content-type"], failed.body]).toEqual([
      500,
      "text/plain; charset=utf-8",
      "Server error: Invalid header name",
    ]);

    const odd = failing(false, "not an Error");
    await handle({ url: "/a/b" }, odd);
    expect([odd.statusCode, odd.body]).toEqual([500, "Server error: not an Error"]);

    const begun = failing(true);
    await expect(handle({ url: "/a/b" }, begun)).resolves.toBeUndefined();
    expect([begun.destroy.mock.calls.length, begun.ended]).toEqual([1, false]);
  });
});

describe("servePages", () => {
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

    const served = await servePages({ root: site });
    expect([served.port, listening?.port]).toEqual([4321, 0]);
    const res = makeRes();
    listening!.server.emit("request", { url: "/a/b" }, res);
    await waitForFinish(res);
    expect([res.statusCode, res.body]).toEqual([200, "<h1>a b</h1>"]);

    served.close();
    expect([dropConnections, close].map((spy) => spy.mock.calls.length)).toEqual([1, 1]);
  });

  it("answers a request for // instead of crashing, as the listener of a server must", async () => {
    stubListen();
    vi.spyOn(Server.prototype, "address").mockReturnValue({ port: 4321 } as never);
    await servePages({ root: bare });
    const res = makeRes();
    listening!.server.emit("request", { url: "//" }, res);
    await waitForFinish(res);
    expect([res.statusCode, res.body]).toEqual([400, "Bad request"]);
  });

  it("is given the port to listen on, and rejects when it cannot", async () => {
    stubListen(new Error("EADDRINUSE"));
    await expect(servePages({ root: site, port: 4173 })).rejects.toThrow("EADDRINUSE");
    expect(listening?.port).toBe(4173);
  });
});

describe("pagesMiddleware", () => {
  const page = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };
  const get = (url: string, headers: Record<string, string> = page, method = "GET") => ({
    ...makeReq(url, headers),
    method,
  });
  const run = async (root: string, req: ReturnType<typeof get>) => {
    const res = makeRes();
    const fell = await runMiddlewares([pagesMiddleware(root)], req, res);
    return { res, fell };
  };

  it("rewrites the path of a 200 rule, keeping the query", async () => {
    const req = get("/sandbox/cells-app?embed=1&x=a?b");
    const { fell, res } = await run(site, req);
    expect(req.url).toBe("/sandbox?embed=1&x=a?b");
    expect([fell, res.statusCode]).toEqual([true, 200]);

    const script = get("/shell", { "sec-fetch-dest": "script", accept: "*/*" });
    expect((await run(site, script)).fell).toBe(true);
    expect(script.url).toBe("/shell.js");
  });

  it("leaves a path no 200 rule matches", async () => {
    for (const url of ["/old", "/bare", "/a/b"]) {
      const req = get(url);
      await run(site, req);
      expect(req.url).toBe(url);
    }
  });

  it("sets the headers of every matching block", async () => {
    const { res, fell } = await run(site, get("/service-worker/service-worker.js", { accept: "*/*" }));
    expect(fell).toBe(true);
    expect(res.headers).toEqual({
      vary: "Accept-Encoding",
      "x-frame-options": "SAMEORIGIN",
      "service-worker-allowed": "/",
    });
  });

  it("never sets Cache-Control", async () => {
    const { res } = await run(site, get("/assets/app.js", { accept: "*/*" }));
    expect(res.headers).toEqual({ vary: "Accept-Encoding", "x-frame-options": "SAMEORIGIN" });
  });

  it("never sets Strict-Transport-Security, and joins a header named in several blocks", async () => {
    const { res } = await run(repeated, get("/x/y.css", { accept: "*/*" }));
    expect(res.headers).toEqual({
      link: "</a.css>; rel=preload, </b.css>; rel=preload, </c.css>; rel=preload",
      vary: "Origin, Accept-Encoding",
    });
  });

  it("answers a page nothing serves with 404.html and a 404", async () => {
    const { res, fell } = await run(site, get("/nucleus/no-such-page"));
    expect(fell).toBe(false);
    expect([res.statusCode, res.body, res.ended]).toEqual([404, "<h1>not found</h1>", true]);
    expect(res.headers).toEqual({
      vary: "Accept-Encoding",
      "x-frame-options": "SAMEORIGIN",
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
  });

  it("answers a directory without an index, as Pages does, with the 404", async () => {
    for (const url of ["/empty", "/empty/"]) {
      const { res, fell } = await run(site, get(url));
      expect([fell, res.statusCode]).toEqual([false, 404]);
    }
  });

  it("passes a page the build serves to Vite", async () => {
    const urls = ["/", "/a/b", "/docs", "/docs/", "/LICENSE", "/sandbox/cells-app"];
    for (const url of urls) {
      const { res, fell } = await run(site, get(url));
      expect([url, fell, res.statusCode, res.ended]).toEqual([url, true, 200, false]);
    }
    // no url at all counts as `/`
    expect((await run(site, { ...makeReq(undefined), method: "GET" })).fell).toBe(true);
  });

  it("moves a page's trailing-slash URL to the slashless one, as Pages does", async () => {
    const { res, fell } = await run(site, get("/a/b/?x=1"));
    expect([fell, res.statusCode, res.headers.location, res.ended]).toEqual([false, 308, "/a/b?x=1", true]);
  });

  const forVite: Record<Kind, (outcome: Awaited<ReturnType<typeof run>>, detail: string) => void> = {
    file: ({ fell, res }) => expect([fell, res.statusCode, res.ended]).toEqual([true, 200, false]),
    moved: ({ fell, res }, detail) =>
      expect([fell, res.statusCode, res.headers.location, res.headers["cache-control"], res.ended]).toEqual([
        false,
        308,
        detail,
        "no-store",
        true,
      ]),
    none: ({ fell, res }) => expect([fell, res.statusCode, res.body]).toEqual([false, 404, SITE["404.html"]]),
    // left to Vite as it came: no rule applied
    unreadable: ({ fell, res }) =>
      expect([fell, res.statusCode, res.headers, res.ended]).toEqual([true, 200, {}, false]),
  };

  it.each(ANSWERS)("$url: $kind $detail $note", async ({ url, kind, detail }) => {
    forVite[kind](await run(site, get(url)), detail);
  });

  it("points Vite at a page it would not find from the URL", async () => {
    // Vite maps `/a` to `a.html` and `/a/` to `a/index.html`, nothing else
    const urls: [string, string][] = [
      ["/docs", "/docs/index.html"],
      ["/docs/?x=1", "/docs/?x=1"],
      ["/home?x=1", "/about.html?x=1"],
      ["/a/b", "/a/b"],
      ["/", "/"],
    ];
    for (const [url, expected] of urls) {
      const req = get(url);
      await run(site, req);
      expect([url, req.url]).toEqual([url, expected]);
    }
  });

  it("never answers a //host URL with a redirect, nor a redirect with a // Location", async () => {
    for (const url of ["//nucleus/docs/x/", "/\\nucleus/docs/x/", "///nucleus/docs/x/"]) {
      const { res, fell } = await run(site, get(url));
      expect([url, fell, res.headers.location, res.statusCode]).toEqual([url, true, undefined, 200]);
    }
    for (const url of [
      "/nucleus//docs/x/",
      "/%2Fnucleus%2Fdocs%2Fx%2F",
      "/%2F%2Fnucleus/docs/x/",
      "/nucleus/docs/x//",
    ]) {
      const { res } = await run(site, get(url));
      expect([url, res.statusCode, res.headers.location]).toEqual([url, 308, "/nucleus/docs/x"]);
    }
  });

  it("never looks at a file above the build, whatever the target", async () => {
    // `secret.html` sits beside the `site` folder: a pass to Vite would show that it was found
    const urls = ["http://h/../../../secret/", "http://h/../secret", "/..%2f..%2fsecret", "/%2e%2e/secret", "/secret/"];
    for (const url of urls) {
      const { res, fell } = await run(site, get(url));
      expect([url, fell, res.statusCode, res.body]).toEqual([url, false, 404, "<h1>not found</h1>"]);
    }
    const { res, fell } = await run(escape, get("/escape"));
    expect([fell, res.statusCode, res.body]).toEqual([false, 404, "<h1>not found</h1>"]);
  });

  it("lets Vite serve what a rule sent to a slashed page, and moves only the slashed URL itself", async () => {
    const home = get("/home");
    const served = await run(slashed, home);
    expect([served.fell, served.res.statusCode, served.res.headers.location, home.url]).toEqual([
      true,
      200,
      undefined,
      "/docs.html",
    ]);
    const docs = await run(slashed, get("/docs/"));
    expect([docs.fell, docs.res.statusCode, docs.res.headers.location]).toEqual([false, 308, "/docs"]);
  });

  it("leaves an unreadable target to Vite without touching the response", async () => {
    for (const url of ["//", "*", "", "http://"]) {
      const req = get(url);
      const { res, fell } = await run(site, req);
      expect([url, fell, req.url, res.headers, res.ended]).toEqual([url, true, url, {}, false]);
    }
  });

  it("hands a failure to the server's error handling", async () => {
    const failure = new Error("Invalid header name");
    const res = Object.assign(makeRes(), {
      setHeader() {
        throw failure;
      },
    });
    const next = vi.fn();
    await pagesMiddleware(site)(get("/a/b"), res, next);
    expect(next.mock.calls).toEqual([[failure]]);
  });

  it("takes a request accepting anything, or nothing, for a page, and HEAD like GET", async () => {
    for (const request of [get("/nope", { accept: "*/*" }), get("/nope", {}), get("/nope", page, "HEAD")]) {
      const { res, fell } = await run(site, request);
      expect([fell, res.statusCode]).toEqual([false, 404]);
    }
  });

  it("leaves what is not a page request to Vite", async () => {
    const requests = [
      get("/nope", page, "POST"),
      get("/nope", page, "OPTIONS"),
      get("/nope.js"),
      get("/nope/", { accept: "application/json" }),
      get("/a/b/", { accept: "application/json" }),
      get("/favicon.ico", { accept: "image/avif,image/webp,*/*" }),
    ];
    for (const request of requests) {
      const { res, fell } = await run(site, request);
      expect([request.url, fell, res.statusCode, res.ended]).toEqual([request.url, true, 200, false]);
    }
  });

  it("does not throw on a malformed escape", async () => {
    const { res, fell } = await run(site, get("/%E0%A4%A"));
    expect([fell, res.statusCode]).toEqual([false, 404]);
  });

  it("changes nothing for a build without _redirects, _headers and 404.html", async () => {
    for (const url of ["/nucleus/no-such-page", "/", "/shell", "/service-worker/service-worker.js"]) {
      const req = get(url);
      const { res, fell } = await run(bare, req);
      expect([fell, req.url, res.statusCode, res.headers, res.ended]).toEqual([true, url, 200, {}, false]);
    }
  });

  it("applies the rules but leaves an unknown page to Vite without a 404.html", async () => {
    const req = get("/sandbox/x");
    const { res, fell } = await run(rulesOnly, req);
    expect([fell, req.url, res.headers["x-frame-options"]]).toEqual([true, "/sandbox", "SAMEORIGIN"]);

    const unknown = await run(rulesOnly, get("/nucleus/no-such-page"));
    expect([unknown.fell, unknown.res.statusCode, unknown.res.headers.vary]).toEqual([true, 200, "Accept-Encoding"]);
  });

  it("reads the rules on every request, so a rebuild applies at once", async () => {
    const root = path.join(tmp, "rebuilt");
    writeFiles(root, { "404.html": "old", "index.html": "" });
    expect((await run(root, get("/missing"))).res.body).toBe("old");
    expect((await run(root, get("/x.js"))).res.headers).toEqual({});

    writeFiles(root, { "404.html": "new", _headers: "/*\n  X-Built: yes\n", _redirects: "/x.js /y.js 200\n" });
    const rebuilt = get("/x.js");
    const { res } = await run(root, rebuilt);
    expect([rebuilt.url, res.headers["x-built"]]).toEqual(["/y.js", "yes"]);
    expect((await run(root, get("/missing"))).res.body).toBe("new");
  });
});

describe("preview mode", () => {
  type PreviewPlugin = { name: string; configurePreviewServer?: (server: FakeServer) => void };

  /** Mounts the given plugins of the preview config, in order, like Vite's preview does. */
  const mount = async (root: string, names: string[]) => {
    const server = makeServer(root, "dist");
    const { plugins } = await createRigViteConfig({ mode: "preview", root });
    for (const plugin of plugins as PreviewPlugin[]) {
      if (names.includes(plugin.name)) plugin.configurePreviewServer?.(server);
    }
    return server;
  };

  it("mounts the Pages middleware over the build output", async () => {
    const server = await mount(pkg, ["pages-rules"]);
    expect(server.middlewares.fns).toHaveLength(1);
    const res = makeRes();
    const unknown = { ...makeReq("/nucleus/no-such-page", { accept: "text/html" }), method: "GET" };
    expect(await runMiddlewares(server.middlewares.fns, unknown, res)).toBe(false);
    expect([res.statusCode, res.body]).toEqual([404, "<h1>not found</h1>"]);
  });

  it("leaves a missing script module to the module rewrite's own 404", async () => {
    const server = await mount(pkg, ["quark-module-extensionless", "pages-rules"]);
    expect(server.middlewares.fns).toHaveLength(2);
    const res = makeRes();
    const script = {
      ...makeReq("/views/missing/missing", { "sec-fetch-dest": "script", accept: "*/*" }),
      method: "GET",
    };
    expect(await runMiddlewares(server.middlewares.fns, script, res)).toBe(false);
    expect([res.statusCode, res.body]).toEqual([
      404,
      "No module at /views/missing/missing (expected /views/missing/missing.js)",
    ]);
  });
});
