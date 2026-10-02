import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Window } from "happy-dom";
import { afterAll, describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, type DomWindow, resetDocument, serve, type ServeOptions, whenIdle } from "../../index";

// files under <root> (and views/), symlinks alias.json (inside) and out.txt (to <root>-secret.txt, outside)
const root = mkdtempSync(join(tmpdir(), "nucleus-dom-serve-"));
mkdirSync(join(root, "views"));
for (const [path, text] of Object.entries({
  "index.html": "<p>shell</p>",
  "x.css": "p { color: red; }",
  "data.json": '{"n":1}',
  "notes.md": "# notes",
  "café.txt": "accent",
  "blob.bin": "bytes",
  "..dots": "dots",
  "font.woff": "woff",
  "app.wasm": "wasm",
  "site.webmanifest": "{}",
  "views/index.html": "<p>views</p>",
  "views/home.quark": "p { content: 1; }",
})) {
  writeFileSync(join(root, path), text);
}
writeFileSync(`${root}-secret.txt`, "secret");
symlinkSync(join(root, "data.json"), join(root, "alias.json"));
symlinkSync(`${root}-secret.txt`, join(root, "out.txt"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(`${root}-secret.txt`, { force: true });
});

const ORIGIN = "https://shop.test";
const served = (options?: ServeOptions, servedRoot: string | URL = root) => {
  const dom = createDom({ url: `${ORIGIN}/` });
  return { ...dom, ...serve(dom.window, servedRoot, options) };
};
const read = async (response: Response) => [response.status, response.headers.get("content-type"), await response.text()];
const consoleOf = (window: DomWindow) => (window as unknown as Window).happyDOM.virtualConsolePrinter.readAsString();

describe("serve", () => {
  it("answers a page's <link rel=stylesheet> from the files, without the network", async () => {
    const { window, document, requests, dispose } = served();
    await resetDocument(window, {
      url: "/cart",
      html: `<html><head><link rel="stylesheet" href="/x.css"></head><body><p>styled</p></body></html>`,
    });
    await whenIdle(window);
    expect(document.querySelector("link")!.sheet!.cssRules).toHaveLength(1);
    expect(window.getComputedStyle(document.querySelector("p")!).color).toBe("red");
    expect(requests).toEqual([{ method: "GET", url: `${ORIGIN}/x.css`, status: 200 }]);
    await dispose();
  });

  it("serves files at the window's origin, typed by extension", async () => {
    const { window, dispose } = served(undefined, pathToFileURL(root));
    const json = await window.fetch("/data.json?x=1");
    expect(await read(json)).toEqual([200, "application/json; charset=utf-8", '{"n":1}']);
    expect(json.url).toBe(`${ORIGIN}/data.json?x=1`);
    expect(await read(await window.fetch("views/home.quark"))).toEqual([200, "text/plain; charset=utf-8", "p { content: 1; }"]);
    expect(await read(await window.fetch("/notes.md"))).toEqual([200, "text/markdown; charset=utf-8", "# notes"]);
    expect((await window.fetch("/blob.bin")).headers.get("content-type")).toBe("application/octet-stream");
    expect(await (await window.fetch("/views")).text()).toBe("<p>views</p>");
    expect(await (await window.fetch("/")).text()).toBe("<p>shell</p>");
    expect(await read(await window.fetch("/caf%C3%A9.txt"))).toEqual([200, "text/plain; charset=utf-8", "accent"]);
    const head = await window.fetch("/data.json", { method: "HEAD" });
    expect(await read(head)).toEqual([200, "application/json; charset=utf-8", ""]);
    expect(await (await window.fetch("data:text/plain,inline")).text()).toBe("inline");
    const types = await Promise.all(
      ["/font.woff", "/app.wasm", "/site.webmanifest"].map(async (path) => (await window.fetch(path)).headers.get("content-type")),
    );
    expect(types).toEqual(["font/woff", "application/wasm", "application/manifest+json; charset=utf-8"]);
    expect([await (await window.fetch("/..dots")).text(), await (await window.fetch("/alias.json")).text()]).toEqual([
      "dots",
      '{"n":1}',
    ]);
    await dispose();
  });

  it("names no file outside root or by an encoded slash; a bad escape or NUL is a 400", async () => {
    const { window, dispose } = served({ fallback: "index.html" });
    const name = root.split(/[\\/]/).at(-1);
    const statuses = await Promise.all(
      ["/out.txt", "/views%2Fhome.quark", `/..%2F${name}-secret.txt`, "/%00", "/%E0%A4%A"].map(
        async (path) => (await window.fetch(path)).status,
      ),
    );
    expect(statuses).toEqual([404, 404, 404, 400, 400]);
    expect(consoleOf(window)).toBe("");
    await dispose();
    const nowhere = served(undefined, join(root, "missing"));
    expect((await nowhere.window.fetch("/data.json")).status).toBe(404);
    await nowhere.dispose();
  });

  it("answers synchronous requests, offline and logged", async () => {
    const { window, requests, dispose } = served();
    const send = (method: string, url: string) => {
      const xhr = new window.XMLHttpRequest();
      const errors = vi.fn();
      xhr.addEventListener("error", errors);
      xhr.open(method, url, false);
      xhr.send();
      return [xhr.status, xhr.getResponseHeader("content-type"), xhr.responseText, errors.mock.calls.length];
    };
    expect(send("GET", "/data.json")).toEqual([200, "application/json; charset=utf-8", '{"n":1}', 0]);
    expect(send("GET", "/views/missing")).toEqual([404, "text/plain; charset=utf-8", "Not found: /views/missing", 0]);
    expect(send("POST", "/api/save")).toEqual([405, null, "", 0]);
    expect(send("GET", "https://cdn.test/lib.js")).toEqual([0, null, "", 1]);
    expect(send("GET", "data:text/plain,inline")[2]).toBe("inline");
    expect(requests.map(({ method, url, status }) => `${method} ${url} ${status}`)).toEqual([
      `GET ${ORIGIN}/data.json 200`,
      `GET ${ORIGIN}/views/missing 404`,
      `POST ${ORIGIN}/api/save 405`,
      "GET https://cdn.test/lib.js 0",
    ]);
    await dispose();
  });

  it.skipIf(process.getuid?.() === 0)("keeps happy-dom's answer for a file it cannot read", async () => {
    const locked = join(root, "locked.json");
    writeFileSync(locked, "{}");
    chmodSync(locked, 0o000);
    const { window, requests, dispose } = served();
    expect(await read(await window.fetch("/locked.json"))).toEqual([
      404,
      "text/html",
      expect.stringContaining("404 Not Found"),
    ]);
    expect(requests.at(-1)!.status).toBe(404);
    await dispose();
  });

  it("falls back for extensionless deep links only, and 404s the rest", async () => {
    const { window, dispose } = served({ fallback: "index.html" });
    expect(await read(await window.fetch("/shop/tables"))).toEqual([200, "text/html; charset=utf-8", "<p>shell</p>"]);
    expect(await read(await window.fetch("/img/missing.png"))).toEqual([404, "text/plain; charset=utf-8", "Not found: /img/missing.png"]);
    expect((await window.fetch("/shop/tables.v2")).status).toBe(404);
    await dispose();
    const plain = served({ fallback: "missing.html" });
    expect((await plain.window.fetch("/shop/tables")).status).toBe(404);
    await plain.dispose();
  });

  it("refuses other origins as a network error", async () => {
    const { window, document, requests, dispose } = served();
    await expect(window.fetch("https://cdn.test/lib.js")).rejects.toThrow(TypeError);
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "https://fonts.test/a.css" });
    const failed = new Promise((resolve) => link.addEventListener("error", resolve));
    document.head.append(link);
    await failed;
    await whenIdle(window);
    expect(requests.map(({ url, status }) => [url, status])).toEqual([
      ["https://cdn.test/lib.js", 0],
      ["https://fonts.test/a.css", 0],
    ]);
    await dispose();
  });

  it("hands /api/* to the api handler first, any method, and falls through when it passes", async () => {
    const api = vi.fn(async (request: Request) => {
      if (request.url.endsWith("/api/own")) return new window.Response("own");
      if (request.url.endsWith("/api/me")) return Response.json({ method: request.method, body: await request.json() });
      if (request.url.endsWith("/api/empty")) return new Response(null, { status: 204 });
      if (request.url.endsWith("/api/down")) return Response.error();
      if (request.url.endsWith("/api/broken")) throw new Error("backend down");
      return null;
    });
    const { window, requests, dispose } = served({ api });
    const me = await window.fetch("/api/me", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(await me.json()).toEqual({ method: "POST", body: { a: 1 } });
    expect([me.url, me instanceof window.Response]).toEqual([`${ORIGIN}/api/me`, true]);
    expect((await window.fetch("/api/empty")).status).toBe(204);
    await expect(window.fetch("/api/down")).rejects.toThrow(TypeError);
    expect(await read(await window.fetch("/api/broken"))).toEqual([500, "text/plain;charset=UTF-8", "Error: backend down"]);
    expect(consoleOf(window)).toContain("backend down");
    expect((await window.fetch("/api/other")).status).toBe(404);
    expect((await window.fetch("/api/other", { method: "DELETE" })).status).toBe(405);
    const own = await window.fetch("/api/own");
    expect([await own.text(), own.url]).toEqual(["own", `${ORIGIN}/api/own`]);
    await window.fetch("/data.json");
    expect(api).toHaveBeenCalledTimes(7);
    expect(requests.map(({ method, status }) => `${method} ${status}`)).toEqual([
      "POST 200",
      "GET 204",
      "GET 0",
      "GET 500",
      "GET 404",
      "DELETE 405",
      "GET 200",
      "GET 200",
    ]);
    await dispose();
  });

  it("refuses writes with 405: files always, api routes too when read-only", async () => {
    const api = vi.fn(() => new Response("saved"));
    const open = served({ api });
    const post = await open.window.fetch("/data.json", { method: "POST", body: "{}" });
    expect([post.status, post.headers.get("allow")]).toEqual([405, "GET, HEAD"]);
    expect(await (await open.window.fetch("/api/save", { method: "POST" })).text()).toBe("saved");
    await open.dispose();
    const readOnly = served({ api, readOnly: true });
    expect((await readOnly.window.fetch("/api/save", { method: "POST" })).status).toBe(405);
    expect(api).toHaveBeenCalledOnce();
    await readOnly.dispose();
  });

  it("logs an aborted request without an answer, and replaces an earlier serve()", async () => {
    const { window, requests, dispose } = served();
    const controller = new AbortController();
    controller.abort();
    await expect(window.fetch("/data.json", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toEqual([{ method: "GET", url: `${ORIGIN}/data.json`, status: 0 }]);
    const again = serve(window, join(root, "views"));
    expect(await (await window.fetch("/home.quark")).text()).toBe("p { content: 1; }");
    expect([requests.length, again.requests.length]).toEqual([1, 1]);
    await dispose();
  });

  it("serves a test environment's window through globalThis", async () => {
    const { settings } = (globalThis as unknown as Window).happyDOM;
    const { requests } = serve(globalThis, root);
    try {
      expect(await (await fetch("/data.json")).json()).toEqual({ n: 1 });
      expect(requests).toEqual([{ method: "GET", url: `${location.origin}/data.json`, status: 200 }]);
    } finally {
      Object.assign(settings.fetch, { interceptor: null, virtualServers: null });
    }
  });
});
