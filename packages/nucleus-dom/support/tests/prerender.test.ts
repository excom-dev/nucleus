import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { createDom, installGlobals, resetDocument, serve, whenIdle } from "../../index";

const root = mkdtempSync(join(tmpdir(), "nucleus-dom-prerender-"));
writeFileSync(join(root, "x.css"), "x-price { color: red; }");
writeFileSync(join(root, "price.json"), '{"n":7}');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PAGE = `<html lang="en"><head><link rel="stylesheet" href="/x.css"></head><body><x-price src="/price.json"></x-price></body></html>`;

describe("prerendering pages in one window", () => {
  it("renders each page from served data, holding long timers, with lazy content in view", async () => {
    const { window, dispose } = createDom({ url: "https://shop.test/", holdTimersAbove: 1000, intersectAll: true });
    const { requests } = serve(window, root, { readOnly: true });
    const restore = installGlobals(window);
    try {
      // module code, as imported after the globals: no reference to `window` above
      class Price extends HTMLElement {
        async connectedCallback() {
          setTimeout(() => this.setAttribute("stale", ""), 3000);
          new IntersectionObserver(([entry]) => entry.isIntersecting && this.setAttribute("seen", "")).observe(this);
          const { n } = await (await fetch(this.getAttribute("src")!)).json();
          this.textContent = `$${n} at ${location.pathname}`;
        }
      }
      customElements.define("x-price", Price);
      for (const path of ["/tables", "/chairs"]) {
        requests.length = 0;
        await resetDocument(window, { url: path, html: PAGE });
        const { held } = await whenIdle(window);
        expect(document.documentElement.outerHTML).toBe(
          `<html lang="en"><head><link rel="stylesheet" href="/x.css"></head><body><x-price src="/price.json" seen="">$7 at ${path}</x-price></body></html>`,
        );
        expect(getComputedStyle(document.querySelector("x-price")!).color).toBe("red");
        expect(held).toEqual([3000]);
        expect(requests.map(({ url, status }) => `${url} ${status}`)).toEqual([
          "https://shop.test/x.css 200",
          "https://shop.test/price.json 200",
        ]);
      }
    } finally {
      restore();
    }
    await dispose();
  });
});
