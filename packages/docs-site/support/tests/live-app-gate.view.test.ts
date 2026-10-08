/**
 * The playground writes (its mount-time DELETE) only once its
 * `<service-worker>` observer mounts, which a prerender never does: the
 * element is not defined there. No static import of it in this file.
 */
import "@excom/content-tabs";
import "@excom/event-handler";
import "@excom/include-content";
import "@excom/provider-fetch";
import "@excom/quark-sheet";
import {
  afterEach,
  describe,
  expect,
  it,
  readFileRelative,
  vi,
  waitForEvent,
} from "@excom/nucleus-test";
import { Quark } from "@excom/quark";
import {
  flush,
} from "@excom/quark/support/tests/view-helpers";

const html = readFileRelative(
  import.meta.url,
  "../../public/views/live-app/live-app.html"
);
const quarkSrc = readFileRelative(
  import.meta.url,
  "../../public/views/live-app/live-app.quark"
);

const originalLoader = Quark.moduleLoader;

afterEach(() => {
  document.body.innerHTML = "";
  Quark.moduleLoader = originalLoader;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live-app view before its worker observer mounts", () => {
  it("renders its header and tabs, writes nothing, and starts once the observer mounts", async () => {
    // never on screen
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    const settings = (window as any).happyDOM?.settings;
    if (settings) settings.disableIframePageLoading = true;
    Quark.moduleLoader = async () => ({
      renderLang: (val: string) => `<pre class="shiki">${val}</pre>`,
      renderPre: () => {},
      buildAppFileLink: () => "",
    });
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://localhost").pathname;
      calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
      return new Response(url.endsWith(".html") ? "<h2>Counter</h2>" : "{}", {
        status: 200,
      });
    });
    const host = document.createElement("spa-route");
    host.setAttribute("data-app", "counter-app");
    host.setAttribute("data-files", "html quark");
    host.innerHTML = html
      .replace(/<link[\s\S]*?>/g, "")
      .replace(/\s+src-url="[^"]*"/g, "");
    const sheet = host.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
    sheet.textContent = quarkSrc;
    document.body.append(host);
    if (!sheet.quarkInstance) await waitForEvent(sheet, "quark-sheet-success");
    for (let i = 0; i < 6; i++) await flush();

    const fresh = host.querySelector("provider-fetch.fresh")!;
    expect(fresh.getAttribute("api-url")).toBe(
      "/api/sandbox/views/counter-app"
    );
    expect(fresh.hasAttribute("is-paused")).toBe(true);
    expect(calls).toEqual(["GET /views/demo-headers/counter-app.html"]);
    expect(host.querySelector("header h2")?.textContent).toBe("Counter");
    expect(
      [...host.querySelectorAll("content-tabs-header")].map((h) =>
        h.textContent?.trim()
      )
    ).toEqual(["counter-app.html", "counter-app.quark"]);
    expect(host.querySelector("provider-fetch.source, iframe")).toBeNull();

    await import("@excom/service-worker");
    await waitForEvent(fresh, "provider-fetch-success");
    expect(fresh.hasAttribute("is-paused")).toBe(false);
    expect(calls).toContain("DELETE /api/sandbox/views/counter-app");

    // started, not loaded: the frame and the editors wait to be on screen
    for (let i = 0; i < 6; i++) await flush();
    expect(
      [...host.querySelectorAll("include-content[lazy-load]")].map((el) =>
        el.hasAttribute("is-active")
      )
    ).toEqual([false, false]);
    expect(host.querySelector("provider-fetch.source, iframe")).toBeNull();
  });
});
