import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import index from "../../index.html?raw";
import sw from "../../sw.js?raw";
import { createHandler } from "../../serve.js";

const request = async (url: string) => {
  const response: { status?: number; headers?: Record<string, string>; body?: unknown } = {};
  await createHandler()(
    { url },
    {
      writeHead: (status: number, headers: Record<string, string>) => Object.assign(response, { status, headers }),
      end: (body: unknown) => Object.assign(response, { body }),
    },
  );
  return response;
};

describe("serve", () => {
  it("serves a file with its content type and no caching", async () => {
    const { status, headers, body } = await request("/sw.js");
    expect(status).toBe(200);
    expect(headers).toEqual({ "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    expect(String(body)).toBe(sw);
  });

  it("types the other files the app loads by extension", async () => {
    const types = { "/shell.css": "text/css; charset=utf-8", "/shell.quark": "text/plain; charset=utf-8", "/img/logo.svg": "image/svg+xml" };
    for (const [url, type] of Object.entries(types)) expect((await request(url)).headers?.["content-type"]).toBe(type);
  });

  it("serves index.html for the root and for deep links", async () => {
    for (const url of ["/", "/shop/tables/thorpe-coffee-table"]) {
      const { status, headers, body } = await request(url);
      expect([status, headers?.["content-type"], String(body)]).toEqual([200, "text/html; charset=utf-8", index]);
    }
  });

  it("falls back to octet-stream for a type it does not list", async () => {
    const { headers } = await request("/CREDITS.md");
    expect(headers?.["content-type"]).toBe("application/octet-stream");
  });

  it("answers 404 for a missing file and for a path it cannot decode", async () => {
    for (const url of ["/img/missing.png", "/%E0%A4%A"]) {
      const { status, headers, body } = await request(url);
      expect([status, headers?.["content-type"], body]).toEqual([404, "text/plain; charset=utf-8", `Not found: ${url}`]);
    }
  });

  it("leaves /api/ to the service worker: 503, never index.html", async () => {
    const { status, headers, body } = await request("/api/me");
    expect([status, headers?.["content-type"]]).toEqual([503, "application/json; charset=utf-8"]);
    expect(JSON.parse(String(body)).message).toContain("service worker");
  });
});
