import { until } from "../../src/browser-page";
import { hydrated, recorder } from "../../src/hydration-check";
import { checkHydration } from "../../testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/nucleus-test";

const KEY = Symbol.for("@excom/kit-utils:hydration");
const kit = globalThis as unknown as Record<
  symbol,
  { booted?: boolean; open?: boolean } | undefined
>;

/** Runs `fn` from its source, as the harness does in a page: it may use nothing outside itself. */
const evaluate = (fn: (...args: never[]) => unknown, args: unknown[]) =>
  (0, eval)(`(${fn})(${args.map((arg) => JSON.stringify(arg)).join(", ")})`);

// the page's animation frames, run by hand
let frames: FrameRequestCallback[] = [];
const paint = () => frames.splice(0).forEach((callback) => callback(0));
// mutation observers report in a later task
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    frames.push(callback)
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete kit[KEY];
  document.body.replaceChildren();
  document.head.replaceChildren();
});

/**
 * A browser page on the test's own document: `goto` runs the scripts added
 * for new documents, parses `markup` as the server's page, ends parsing
 * ("interactive"), then hydrates with `hydrate` while the window is open.
 * Functions run from their source as in a page (`fromSource`), or called,
 * so that coverage sees them.
 */
const fakePage = (
  markup: string,
  hydrate: () => unknown = () => {},
  { closes = true, fromSource = false } = {}
) => {
  const scripts = new Map<string, string>();
  const calls: string[] = [];
  return {
    calls,
    cdp: async (
      method: string,
      params: { source?: string; identifier?: string }
    ) => {
      calls.push(method);
      if (method !== "Page.addScriptToEvaluateOnNewDocument")
        return scripts.delete(params.identifier!);
      const identifier = `script-${scripts.size + 1}`;
      scripts.set(identifier, params.source!);
      return { identifier };
    },
    goto: async () => {
      scripts.forEach((source) => {
        // the recorder, as checkHydration adds it
        const [, loading] = /^\(.*\)\((".*")\)$/s.exec(source)!;
        expect(source).toBe(`(${recorder})(${loading})`);
        if (fromSource) (0, eval)(source);
        else recorder(JSON.parse(loading));
      });
      document.body.innerHTML = markup;
      Object.defineProperty(document, "readyState", {
        configurable: true,
        get: () => "interactive",
      });
      document.dispatchEvent(new Event("readystatechange"));
      delete (document as { readyState?: unknown }).readyState;
      kit[KEY] = { booted: true, open: true };
      await hydrate();
      await tick();
      kit[KEY]!.open = !closes;
    },
    run: async <A extends unknown[], T>(fn: (...args: A) => T, ...args: A) =>
      (await (fromSource
        ? evaluate(fn as never, args)
        : fn(...(JSON.parse(JSON.stringify(args)) as A)))) as Awaited<T>,
  };
};

const SERVER = `<spa-manager has-rendered=""><p id="kept" bind-title="x">Server</p><ul class="list"><li>one</li><li>two</li></ul><x-flip did-load="" n-ssr="0" n-util-select-id-k3=""></x-flip><div no-ssr=""><span>Loading…</span></div><x-gone data-state="on"></x-gone><include-content pre-fetch="" template-ref="/views/idle.html"></include-content></spa-manager>`;

/** What the browser does to SERVER as it hydrates: every kind of change, and changes that are none. */
const hydrateServer = async () => {
  const flip = document.querySelector("x-flip")!;
  // expected to go: a claimed provision, kit-utils' momentary id
  flip.removeAttribute("n-ssr");
  flip.removeAttribute("n-util-select-id-k3");
  // goes and returns between two frames: never painted, counted
  flip.removeAttribute("did-load");
  await tick();
  flip.setAttribute("did-load", "");
  await tick();
  document.querySelector("#kept")!.firstChild!.textContent = "Client";
  document.querySelector("li")!.remove();
  document.body.append(document.createElement("b"));
  // the head gets module preloads; a no-ssr region mounts as on a cold load
  document.head.append(document.createElement("link"));
  document
    .querySelector("[no-ssr]")!
    .replaceChildren(document.createElement("section"));
  // loading in the region, through the end: neither a frame nor the wait sees it
  document.querySelector("[no-ssr] > section")!.setAttribute("is-loading", "");
  document.querySelector("[no-ssr]")!.setAttribute("is-ready", "");
  // gone in a painted frame and at the end; a loading state painted once
  document.querySelector("x-gone")!.removeAttribute("data-state");
  document.querySelector("ul")!.setAttribute("is-loading", "");
  await tick();
  paint();
  document.querySelector("ul")!.removeAttribute("is-loading");
  await tick();
  paint();
  (
    document as { startViewTransition?: (update: () => void) => unknown }
  ).startViewTransition?.(() => {});
};

const RESOURCES = [
  { name: "http://localhost/views/old.html", startTime: -1 },
  { name: "http://localhost/views/a.html", startTime: 1e9 },
  { name: "http://localhost/views/a.quark", startTime: 1e9 },
  { name: "http://localhost/views/idle.html", startTime: 1e9 },
  { name: "http://localhost/api/me", startTime: 1e9 },
];

describe("checkHydration", () => {
  it.each([
    ["called", false],
    ["run from their source, as in a page", true],
  ])(
    "records what hydration did to the server's DOM, frame by frame, then reports it once the page has hydrated: in-page functions %s",
    async (_, fromSource) => {
      // `document`'s own prototype: the test environment's `Document` is another realm's
      const proto = Object.getPrototypeOf(document) as {
        startViewTransition?: unknown;
      };
      vi.stubGlobal("Document", { prototype: proto });
      proto.startViewTransition = (update: () => void) => update();
      vi.spyOn(performance, "getEntriesByType").mockReturnValue(
        RESOURCES as never
      );
      try {
        const page = fakePage(SERVER, hydrateServer, { fromSource });
        const report = await checkHydration(page, "/menu", {
          loading: "[is-loading]",
          requests: /^\/views\//,
        });
        expect(report).toEqual({
          // each server attribute that went: painted (data-state) or not (did-load)
          flips: 2,
          changes: [
            `text: html > body > spa-manager > p#kept[bind-title="x"]`,
            'removed: html > body > spa-manager > ul[class="list"] > li',
            "added: html > body > b",
            "attribute removed: html > body > spa-manager > x-gone [data-state]",
            `frame showed: html > body > spa-manager > ul[class="list"]`,
            "frame showed: html > body > spa-manager > x-gone without [data-state]",
            "view transitions: 1",
            "request: /views/a.html",
          ],
        });
        // the recorder is in new documents for the check only
        expect(page.calls).toEqual([
          "Page.addScriptToEvaluateOnNewDocument",
          "Page.removeScriptToEvaluateOnNewDocument",
        ]);
      } finally {
        delete proto.startViewTransition;
      }
    }
  );

  it("leaves out what `allow` matches, and counts requests only when asked", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue(
      RESOURCES as never
    );
    const report = await checkHydration(
      fakePage(SERVER, hydrateServer),
      "/menu",
      {
        loading: "[is-loading]",
        allow: [/^added: /, /^frame showed: .*ul/],
      }
    );
    expect(report.changes).toEqual([
      `text: html > body > spa-manager > p#kept[bind-title="x"]`,
      'removed: html > body > spa-manager > ul[class="list"] > li',
      "attribute removed: html > body > spa-manager > x-gone [data-state]",
      "frame showed: html > body > spa-manager > x-gone without [data-state]",
    ]);
  });

  it("reports server markup with a spa-manager that has not rendered, and none without a spa-manager", async () => {
    const check = (markup: string) =>
      checkHydration(fakePage(markup), "/", { loading: "[is-loading]" });
    expect((await check("<spa-manager></spa-manager>")).changes).toEqual([
      "server markup: spa-manager without has-rendered",
    ]);
    expect(await check("<main></main>")).toEqual({ flips: 0, changes: [] });
  });

  it("throws when the page is still hydrating after 15 s, and takes the recorder out of new documents", async () => {
    const page = fakePage("<main></main>", () => {}, { closes: false });
    // 10 s pass at each look at the clock
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 10_000));
    await expect(
      checkHydration(page, "/", { loading: "[is-loading]" })
    ).rejects.toThrow("still hydrating after 15 s");
    expect(page.calls.at(-1)).toBe("Page.removeScriptToEvaluateOnNewDocument");
  });

  it("throws the first error when Chrome is gone, not the failed removal of its recorder", async () => {
    const page = fakePage("<main></main>");
    page.goto = () => Promise.reject(new Error("Chrome exited (code 1)"));
    const cdp = page.cdp;
    page.cdp = async (method, params) =>
      method === "Page.removeScriptToEvaluateOnNewDocument"
        ? Promise.reject(new Error("Chrome is gone"))
        : cdp(method, params);
    await expect(
      checkHydration(page, "/", { loading: "[is-loading]" })
    ).rejects.toThrow("Chrome exited (code 1)");
  });
});

describe("hydrated", () => {
  const check = () => evaluate(hydrated, ["[is-loading]"]);

  it("waits for the kit's hydration window to have opened and closed, and for nothing loading", async () => {
    expect(await check()).toBe(false);
    kit[KEY] = { booted: true, open: true };
    expect(await check()).toBe(false);
    kit[KEY] = { booted: true, open: false };
    document.body.innerHTML = `<main is-loading=""></main>`;
    expect(await check()).toBe(false);
    document.body.innerHTML = `<main></main>`;
    expect(await check()).toBe(true);
    // a no-ssr region loads as on a cold load: not waited for
    document.body.innerHTML = `<main></main><div no-ssr=""><p is-loading=""></p></div><section no-ssr="" is-loading=""></section>`;
    expect(await check()).toBe(true);
  });

  it("waits for Quark to settle", async () => {
    kit[KEY] = { booted: true, open: false };
    let settled = false;
    const sheet = document.body.appendChild(
      document.createElement("quark-sheet")
    );
    const whenSettled = async () => {
      await tick();
      settled = true;
    };
    Object.assign(sheet, { quarkInstance: { constructor: { whenSettled } } });
    expect(await check()).toBe(true);
    expect(settled).toBe(true);
  });
});

describe("until", () => {
  it("counts a check that throws or rejects as not yet", async () => {
    let calls = 0;
    const check = () => {
      if (++calls === 1) throw new Error("not yet");
      return calls === 2 ? Promise.reject(new Error("not yet")) : true;
    };
    expect(await until(check, 5000)).toBe(true);
    expect(calls).toBe(3);
  });
});
