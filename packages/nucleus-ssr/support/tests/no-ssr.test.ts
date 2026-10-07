/**
 * Elements kept out of the prerender (`no-ssr`, a Neutron tag's `ssr:
 * false`), with the real Nucleus Kit server entry: written as authored, then
 * mounted in the browser as on a cold load, which `hydrate()` expects.
 */
import { createRenderer, type Renderer } from "../../index";
import { hydrate, type HydrationReport } from "../../testing";
import { ORIGIN, parse, SITE } from "./helpers";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "@excom/nucleus-test";
import { join } from "node:path";

const ROOT = join(SITE, "../no-ssr");
const DEMO = `${ORIGIN}/views/demo.html`;

let kit: typeof import("@excom/nucleus-kit/server");

/** The server kit, a client-only element (ready once mounted), and one that notes where it mounted. */
const entry = async () => {
  vi.resetModules();
  kit = await import("@excom/nucleus-kit/server");
  const { isServerRender } = await import("@excom/kit-utils");
  kit
    .Neutron({ tag: "x-client", props: { isReady: Boolean }, ssr: false })
    .onConnected(() => ({ isReady: true }))
    .define();
  kit
    .Neutron({ tag: "x-mount", props: { mountedOn: String } })
    .onConnected(() => ({ mountedOn: isServerRender() ? "server" : "browser" }))
    .define();
  return { ...kit, settle: () => kit.Quark.whenSettled() };
};

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Demos</title></head><body>${body}</body></html>`;
const PAGES: Record<string, string> = {
  "/attribute": page(
    `<include-content id="demo" no-ssr is-active template-ref="/views/demo.html"><p>Loading the demo…</p></include-content>`
  ),
  // a view whose sheet writes `no-ssr` on its demo, as the docs site's does
  "/sheet": page(
    `<include-content id="package" is-active template-ref="/views/package.html"></include-content>`
  ),
  "/tag": page(`<x-client id="client"><x-mount id="inner"></x-mount></x-client>`),
  // active from the markup, marked by a sheet once it started
  "/late": page(
    `<include-content id="late" is-active template-ref="/views/demo.html"><p>Loading…</p></include-content><quark-sheet>#late { no-ssr: ""; }</quark-sheet>`
  ),
};

const NO_CHANGE = {
  removed: [],
  added: [],
  attributes: [],
  texts: [],
  flashes: [],
};

/** `report`'s `rewrites` in or on the element at `path`. */
const rewritesIn = (report: HydrationReport, path: string) =>
  report.rewrites.filter(
    ({ element }) => element === path || element.startsWith(`${path} > `)
  );

const islandUrls = (html: string): string[] =>
  JSON.parse(parse(html).getElementById("nucleus-hydration")!.textContent!).responses.map(
    ({ url }: { url: string }) => url
  );

describe("an element kept out of the prerender", () => {
  let renderer: Renderer;

  beforeAll(async () => {
    renderer = await createRenderer({
      root: ROOT,
      origin: ORIGIN,
      entry,
      shell: (url) => PAGES[url],
    });
  });

  afterAll(() => renderer.close());

  /** Renders `url`: no error, the demo's view never requested nor shipped. */
  const render = async (url: string) => {
    const { html, diagnostics } = await renderer.render(url);
    expect(diagnostics.errors).toEqual([]);
    expect(diagnostics.requests.map(({ url }) => url)).not.toContain(DEMO);
    expect(islandUrls(html)).not.toContain("/views/demo.html");
    return { html, document: parse(html) };
  };

  it("with no-ssr, is written as authored, then loads in the browser", async () => {
    const { html, document } = await render("/attribute");
    const demo = document.getElementById("demo")!;
    expect(demo.innerHTML).toBe("<p>Loading the demo…</p>");
    expect(demo.getAttributeNames()).toEqual([
      "id",
      "no-ssr",
      "is-active",
      "template-ref",
    ]);

    const report = await hydrate(renderer.window, html);
    expect(report).toMatchObject({
      ...NO_CHANGE,
      keptOut: ["body > include-content#demo"],
    });
    expect(rewritesIn(report, "body > include-content#demo")).toEqual([]);
    expect(report.requests).toContainEqual({
      method: "GET",
      url: DEMO,
      status: 200,
    });
    const live = renderer.window.document.getElementById("demo")!;
    expect(live.hasAttribute("did-load")).toBe(true);
    expect(live.innerHTML).toContain("<p>Live demo</p>");
  });

  it("marked no-ssr by a sheet once mounted (`no-ssr` first in its rule), stays unrendered", async () => {
    const { html, document } = await render("/sheet");
    const demo = document.querySelector("[data-demo]")!;
    expect(
      Object.fromEntries(
        demo.getAttributeNames().map((name) => [name, demo.getAttribute(name)])
      )
    ).toEqual({
      "data-demo": "simple",
      "no-ssr": "",
      "template-ref": "/views/demo.html",
      "lazy-load": "",
    });
    expect(demo.innerHTML.trim()).toBe("<p>Demo placeholder</p>");
    // the view around it is prerendered
    expect(islandUrls(html)).toEqual([
      "/views/package.html",
      "/views/package.quark",
    ]);

    const report = await hydrate(renderer.window, html);
    expect(report).toMatchObject({
      ...NO_CHANGE,
      keptOut: ["body > include-content#package > article > include-content"],
    });
    expect(
      rewritesIn(report, "body > include-content#package > article > include-content")
    ).toEqual([]);
    expect(report.requests).toContainEqual({
      method: "GET",
      url: DEMO,
      status: 200,
    });
    expect(
      renderer.window.document.querySelector("[data-demo]")!.innerHTML
    ).toContain("<p>Live demo</p>");
  });

  it("of an ssr: false tag, is written as authored, what it holds prerendered, then mounts in the browser", async () => {
    const { html, document } = await render("/tag");
    // its own code never ran; its child's did
    expect(document.getElementById("client")!.outerHTML).toBe(
      `<x-client id="client"><x-mount id="inner" mounted-on="server"></x-mount></x-client>`
    );

    const report = await hydrate(renderer.window, html);
    // its own attributes are its mount's; its child's change is reported
    expect(report).toMatchObject({
      ...NO_CHANGE,
      attributes: [
        {
          element: "body > x-client#client > x-mount#inner",
          name: "mounted-on",
          server: "server",
          final: "browser",
        },
      ],
      keptOut: ["body > x-client#client"],
    });
    expect(
      renderer.window.document.getElementById("client")!.hasAttribute("is-ready")
    ).toBe(true);
  });

  it("marked no-ssr only once it had started, fails the page", async () => {
    const error = await renderer.render("/late").catch((error) => error);
    // loading or loaded by then: `[is-loading]`, or `[n-tpl], [did-load]`
    expect(error.diagnostics.errors).toContainEqual(
      expect.stringMatching(
        /^<include-content id="late" [^>]*\bno-ssr\b[^>]*> holds \[[^:]+: no-ssr reached it after it had started, and belongs in the markup or first in the rule that activates it$/
      )
    );
  });
});
