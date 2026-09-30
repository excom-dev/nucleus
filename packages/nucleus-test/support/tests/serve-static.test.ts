import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, serveStatic, vi } from "../../index";

// <root>/index.html, <root>/views/{index.html,home.quark,notes.md}, <root>/data.json; <root>-secret.txt beside it
const root = mkdtempSync(join(tmpdir(), "nucleus-test-serve-"));
mkdirSync(join(root, "views"));
writeFileSync(join(root, "index.html"), "<p>shell</p>");
writeFileSync(join(root, "views/index.html"), "<p>views</p>");
writeFileSync(join(root, "views/home.quark"), "p { content: 1; }");
writeFileSync(join(root, "views/notes.md"), "# notes");
writeFileSync(join(root, "data.json"), '{"n":1}');
writeFileSync(`${root}-secret.txt`, "secret");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(`${root}-secret.txt`, { force: true });
});

const read = async (response: Response) => [response.status, response.headers.get("content-type"), await response.text()];

describe("serveStatic", () => {
  it("serves files at the page's origin, typed by extension", async () => {
    const fetch = serveStatic(root);
    const html = await fetch("/views/index.html?x=1");
    expect(await read(html)).toEqual([200, "text/html; charset=utf-8", "<p>views</p>"]);
    expect(html.url).toBe(`${location.origin}/views/index.html?x=1`);
    expect(await read(await fetch("views/home.quark"))).toEqual([200, "text/plain; charset=utf-8", "p { content: 1; }"]);
    expect(await (await fetch(new URL("/data.json", location.href))).json()).toEqual({ n: 1 });
    expect((await fetch("/views/notes.md")).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("serves a folder's index.html, and a file: URL root", async () => {
    const fetch = serveStatic(pathToFileURL(root));
    expect(await (await fetch("/views/")).text()).toBe("<p>views</p>");
    expect(await (await fetch("/")).text()).toBe("<p>shell</p>");
  });

  it("falls back for extensionless deep links only", async () => {
    const fetch = serveStatic(root, { fallback: "index.html" });
    expect(await read(await fetch("/shop/tables"))).toEqual([200, "text/html; charset=utf-8", "<p>shell</p>"]);
    expect(await read(await fetch("/img/missing.png"))).toEqual([404, "text/plain; charset=utf-8", "Not found: /img/missing.png"]);
    expect((await serveStatic(root)("/shop/tables")).status).toBe(404);
  });

  it("answers 404 outside the root and for a path it cannot decode", async () => {
    const fetch = serveStatic(root, { fallback: "index.html" });
    const name = root.split(/[\\/]/).at(-1);
    for (const path of [`/..%2F${name}-secret.txt`, "/%E0%A4%A"]) expect((await fetch(path)).status).toBe(404);
  });

  it("hands /api/* to the api handler as a Request, and falls through when it passes", async () => {
    const api = vi.fn(async (request: Request) =>
      request.url.endsWith("/api/me") ? Response.json({ method: request.method, body: await request.json() }) : null,
    );
    const fetch = serveStatic(root, { api });
    const me = await fetch("/api/me", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(await me.json()).toEqual({ method: "POST", body: { a: 1 } });
    expect(me.url).toBe(`${location.origin}/api/me`);
    expect((await fetch(new Request(`${location.origin}/api/other`))).status).toBe(404);
    await fetch("/data.json");
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("rejects other origins and aborted requests", async () => {
    const fetch = serveStatic(root);
    await expect(fetch("https://example.com/data.json")).rejects.toThrow(TypeError);
    const controller = new AbortController();
    controller.abort();
    await expect(fetch("/data.json", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
