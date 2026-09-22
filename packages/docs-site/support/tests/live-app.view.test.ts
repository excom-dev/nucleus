import "@excom/content-tabs";
import "@excom/event-handler";
import "@excom/include-content";
import "@excom/provider-fetch";
import "@excom/quark-sheet";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { Quark } from "@excom/quark";
import {
  bypassSelectorCache,
  click,
  expectComplexity,
  flush,
  measureComplexity,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(import.meta.url, "../../public/views/live-app/live-app.html");
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/live-app/live-app.quark",
);

const APP = "cells-app";
const FILES = ["html", "quark", "js", "css"];
const SOURCES: Record<string, string> = {
  html: "<article id=\"cells-app\"><p>hi</p></article>\n",
  css: "#cells-app { color: red; }\n",
  quark: ":scope { form { @on submit (prevent-default); } }\n",
  js: "export const range = (n) => [];\n",
};
const apiPath = (ext: string) => `/api/sandbox/views/${APP}/${APP}.${ext}`;

/** Minimal stand-in for `@use "/shell"`, the real module boots Shiki. */
const shellStub = {
  renderLang: (val: string, lang: string) =>
    `<pre class="shiki" data-lang="${lang}">${val
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre>`,
  renderPre: (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    target.parentElement!.querySelector("[data-highlight]")!.innerHTML =
      shellStub.renderLang(target.value, "any");
  },
  buildAppFileLink: (app: string, ext: string) =>
    `https://github.com/excom-dev/nucleus/tree/main/packages/docs-site/public/views/${app}/${app}.${ext}`,
};

type Call = { method: string; url: string; body?: string };
const calls: Call[] = [];
const overrides = new Map<string, string>();

const mockFetch = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });
    const ext = /\.(\w+)$/.exec(url)?.[1] ?? "";
    if (method === "GET" && url.startsWith("/views/demo-headers/")) {
      return new Response("<hgroup><h2>Cells</h2><p>intro</p></hgroup>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (method === "GET") {
      return new Response(overrides.get(ext) ?? SOURCES[ext] ?? "", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-sandbox-source": overrides.has(ext) ? "override" : "original",
        },
      });
    }
    if (method === "PUT") overrides.set(ext, JSON.parse(body!).content);
    // a directory DELETE (mount) drops every override of the app
    if (method === "DELETE") ext ? overrides.delete(ext) : overrides.clear();
    return new Response(JSON.stringify({ path: url }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

const stripAssets = (s: string) =>
  s.replace(/<link[\s\S]*?>/g, "").replace(/\s+src-url="[^"]*"/g, "");

/** Mount the view under a stand-in for the hosting `spa-route[data-app]`. */
const mountApp = async () => {
  const host = document.createElement("spa-route");
  host.setAttribute("data-app", APP);
  host.setAttribute("data-files", FILES.join(" "));
  host.innerHTML = stripAssets(html);
  const sheet = host.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
  sheet.textContent = quarkSrc;
  document.body.append(host);
  if (!sheet.quarkInstance) await waitForEvent(sheet, "quark-sheet-success");
  const root = host.querySelector<HTMLElement>(".live-app")!;
  // four source reads
  for (let i = 0; i < 20 && sourcesOf(root).length < FILES.length; i++) {
    await flush();
  }
  await Promise.all(
    sourcesOf(root).map((p) =>
      p.hasAttribute("is-success")
        ? undefined
        : waitForEvent(p, "provider-fetch-success"),
    ),
  );
  await flush();
  await flush();
  return { root, quark: sheet.quarkInstance! };
};

const sourcesOf = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("provider-fetch.source")];

const bodyOf = (root: HTMLElement, ext: string) =>
  root.querySelector<HTMLElement>(`content-tabs-body[tab-name="${ext}"]`)!;

const sourceOf = (root: HTMLElement, ext: string) =>
  bodyOf(root, ext).querySelector<HTMLElement>("provider-fetch.source")!;

const textareaOf = (root: HTMLElement, ext: string) =>
  bodyOf(root, ext).querySelector<HTMLTextAreaElement>("textarea")!;

const originalLoader = Quark.moduleLoader;

/* happy-dom caches `matches(":has()")`; the preview gate is a `:has()` rule */
let restoreSelectorCache: () => void;

describe("live-app view", () => {
  beforeAll(() => {
    restoreSelectorCache = bypassSelectorCache();
  });
  afterAll(() => restoreSelectorCache());
  beforeEach(() => {
    calls.length = 0;
    overrides.clear();
    // happy-dom would try to navigate the preview iframe
    const settings = (window as any).happyDOM?.settings;
    if (settings) settings.disableIframePageLoading = true;
    Quark.moduleLoader = async (url: string) => {
      if (url.includes("shell")) return shellStub;
      throw new Error(`unexpected @use module: ${url}`);
    };
    mockFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Quark.moduleLoader = originalLoader;
    vi.restoreAllMocks();
  });

  it("renders one editor per file, saves edits, reloads the preview, and resets", async () => {
    const { root, quark } = await mountApp();

    // one tab + editor per file, first open, sources read through the overlay
    const headers = [...root.querySelectorAll("content-tabs-header")];
    expect(headers.map((h) => h.textContent?.trim())).toEqual(
      FILES.map((ext) => `${APP}.${ext}`),
    );
    expect(headers.map((h) => h.getAttribute("data-file-type"))).toEqual(FILES);
    expect(headers[0].hasAttribute("is-open")).toBe(true);
    expect(bodyOf(root, "html").hasAttribute("is-open")).toBe(true);
    // the mount drops the app's stored edits before any file is read
    const sandboxCalls = calls.filter((c) => c.url.startsWith("/api/sandbox/"));
    expect(sandboxCalls[0]).toEqual({ method: "DELETE", url: `/api/sandbox/views/${APP}` });
    expect(
      calls
        .filter((c) => c.method === "GET" && c.url.startsWith("/api/sandbox/"))
        .map((c) => c.url),
    ).toEqual(FILES.map(apiPath));
    for (const ext of FILES) {
      expect(sourceOf(root, ext).getAttribute("data-file-source")).toBe("original");
    }
    expect(root.querySelector("header h2")?.textContent).toBe("Cells");
    for (const ext of FILES) {
      expect(textareaOf(root, ext).value).toBe(SOURCES[ext]);
      expect(
        bodyOf(root, ext).querySelector("[data-highlight] .shiki")?.textContent,
      ).toBe(SOURCES[ext]);
      expect(
        bodyOf(root, ext).querySelector(".code-editor")?.getAttribute("data-language"),
      ).toBe(ext);
    }
    expect(
      bodyOf(root, "js").querySelector("a[aria-label='github']")?.getAttribute("href"),
    ).toMatch(/cells-app\.js$/);

    // preview iframe points at the sandbox document
    const iframe = root.querySelector<HTMLIFrameElement>(
      "[aria-label='preview'] iframe",
    )!;
    expect(iframe.getAttribute("src")).toBe(`/sandbox/${APP}`);

    // typing saves the file (PUT debounced 600 ms) and rebuilds the preview
    const css = textareaOf(root, "css");
    const meter = measureComplexity(quark);
    css.value = "#cells-app { color: blue; }\n";
    css.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(
      bodyOf(root, "css").querySelector("[data-highlight] .shiki")?.textContent,
    ).toBe(css.value);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    await wait(650);
    await flush();
    const budget = meter.take();
    meter.stop();

    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe(apiPath("css"));
    expect(JSON.parse(put!.body!)).toEqual({ content: css.value });
    const rebuilt = root.querySelector<HTMLIFrameElement>(
      "[aria-label='preview'] iframe",
    )!;
    expect(rebuilt).not.toBe(iframe);
    expect(rebuilt.getAttribute("src")).toBe(`/sandbox/${APP}`);
    // the editor itself is left alone while typing
    expect(textareaOf(root, "css")).toBe(css);

    // reset drops the override, re-reads the original and rebuilds the editor
    click(bodyOf(root, "css").querySelector("[aria-label='reset']"));
    await flush();
    for (let i = 0; i < 20 && textareaOf(root, "css") === css; i++) await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      `/api/sandbox/views/${APP}`,
      apiPath("css"),
    ]);
    expect(calls.filter((c) => c.method === "GET" && c.url === apiPath("css")).length).toBe(2);
    const fresh = textareaOf(root, "css");
    expect(fresh).not.toBe(css);
    expect(fresh.value).toBe(SOURCES.css);
    expect(sourceOf(root, "css").getAttribute("data-file-source")).toBe("original");
    expect(root.querySelector<HTMLIFrameElement>("[aria-label='preview'] iframe")).not.toBe(
      rebuilt,
    );

    expectComplexity(budget);
  });
});
