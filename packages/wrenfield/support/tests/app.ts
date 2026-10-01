// The app on happy-dom: index.html's body, files served from the package, /api/* through the worker.
// The whole Nucleus Kit from source: every element defined.
import { Quark } from "@excom/nucleus-kit";
import { afterEach, consoleSinks, expect, onTestFinished, readFileRelative, serveStatic, trackComplexity, vi } from "@excom/nucleus-test";
import { popstate, resetRouter, trackUnhandledRejections } from "@excom/spa-route/testing";
import { loadWorker, ROOT } from "./backend/worker.mjs";

// No Node types in this package: only the environment is read.
declare const process: { env: Record<string, string | undefined> } | undefined;

export type Call = [method: string, path: string, body?: unknown];

/** The Chrome suite's viewports; `detect-media` turns them into the layout fact. */
export const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
export const TABLE = { path: "/shop/tables/thorpe-coffee-table", sku: "WF-1014", name: "Thorpe Coffee Table" };
export const BAG: Call[] = [["POST", "/bag", { sku: TABLE.sku }], ["POST", "/bag", { sku: "WF-1019" }]];
export const ORDER: Call[] = [...BAG, ["PATCH", "/checkout", { delivery: "collect" }], ["POST", "/orders"]];
export const TOTALS = { Subtotal: "$7,400", "Trade discount": "$0", Delivery: "Free", Total: "$7,400" };
export const SCHEDULE = { "Due today": "$5,600", "Due when ready": "$1,800" };

const { happyDOM } = globalThis as unknown as {
  happyDOM: { settings: object; setViewport: (size: { width: number; height: number }) => void };
};
// happy-dom loads a view's `<link rel=stylesheet>` itself, from the network, past the fetch stand-in.
Object.assign(happyDOM.settings, { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true });

// The body only: parsing the head loads its remote stylesheets too.
const INDEX = new DOMParser().parseFromString(
  readFileRelative(import.meta.url, "../../index.html")
    .match(/<body[\s\S]*<\/body>/)![0]
    .replace(/<script[\s\S]*?<\/script>|<link[^>]+href="https?:[^>]*>/g, ""),
  "text/html",
).body;

// happy-dom 20.8 throws on `:has(~ …)` (shell.quark's inert rules): evaluate a trailing one as a sibling query.
const SIBLING_HAS = /^(.*):has\(\s*~\s*(.+)\)$/;
const hasSibling = (element: Element, siblings: string) => {
  element.setAttribute("wf-sibling-has", "");
  try {
    return !!element.parentElement?.querySelector(`[wf-sibling-has] ~ ${siblings}`);
  } finally {
    element.removeAttribute("wf-sibling-has");
  }
};
const { matches, querySelectorAll } = Element.prototype;
Element.prototype.querySelectorAll = function (this: Element, selectors: string) {
  const [, own, siblings] = String(selectors).match(SIBLING_HAS) ?? [];
  const found = querySelectorAll.call(this, siblings ? own : selectors);
  return siblings ? [...found].filter((element) => hasSibling(element, siblings)) : found;
} as typeof querySelectorAll;
Element.prototype.matches = function (this: Element, selectors: string) {
  const [, own, siblings] = String(selectors).match(SIBLING_HAS) ?? [];
  return siblings ? matches.call(this, own) && hasSibling(this, siblings) : matches.call(this, selectors);
};

const clean = (element: Element | null) => element?.textContent?.trim().replace(/\s+/g, " ");
export const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
export const text = (selector: string) => clean($(selector));
/** A dl as `{ term: definition }`. */
export const terms = (selector: string) =>
  Object.fromEntries($$(`${selector} dt`).map((dt) => [clean(dt), clean(dt.nextElementSibling)]));
export const where = () => ({
  url: location.pathname + location.search,
  title: document.title,
  tab: $("#tabs > [aria-current]")?.dataset.tab ?? null,
});

// Polls report their own diff before the test times out.
vi.setConfig({ testTimeout: 20_000 });
/** Polls `fn` until the matcher passes: the Chrome suite's `expect`. */
export const until = <T>(fn: () => T | Promise<T>): ReturnType<typeof expect.poll<T>> =>
  expect.poll(fn, { timeout: 10_000, interval: 10 });

// One stand-in for the whole file: a request that outlives its test (an idle pre-fetch, a late template) gets a file, not the network.
type Gate = { pattern: RegExp; waiting: number; opened: Promise<void>; release: () => void };
const page = { serve: serveStatic(ROOT, { fallback: "index.html" }), issues: [] as string[], inflight: 0, gates: [] as Gate[] };
globalThis.fetch = async (input, init) => {
  page.inflight++;
  try {
    const response = await page.serve(input, init);
    const method = (input instanceof Request ? input.method : (init?.method ?? "GET")).toUpperCase();
    if (!response.ok) page.issues.push(`${method} ${new URL(response.url).pathname} -> ${response.status}`);
    return response;
  } finally {
    page.inflight--;
  }
};

/** Resolves once no request is in flight and Quark settled twice running: the Chrome suite's settle. */
export const idle = async () => {
  for (let quiet = 0; quiet < 2; ) {
    const settled = (await Quark.whenSettled()) === "settled" && page.inflight === 0;
    quiet = settled ? quiet + 1 : 0;
  }
};
/**
 * Holds `/api` requests matching `pattern` ("GET /api/home?a=1") until the returned `release()`, so a test
 * sees the page while it waits; `idle` ignores a held request. Call before `openApp` to hold a first load.
 */
export const hold = (pattern: RegExp) => {
  let open!: () => void;
  const gate: Gate = {
    pattern,
    waiting: 0,
    opened: new Promise<void>((resolve) => (open = resolve)),
    release: () => {
      page.gates = page.gates.filter((held) => held !== gate);
      page.inflight += gate.waiting; // in flight again before `idle` can look
      gate.waiting = 0;
      open();
    },
  };
  page.gates.push(gate);
  return gate.release;
};
const route = ({ method, url }: Request) => `${method} ${url.slice(location.origin.length)}`;
/** Runs `action`, then waits for the page to settle: the Chrome suite's `page.do`. */
export const act = async (action: () => unknown) => {
  await action();
  await idle();
};

/** Types into each input, keyed by selector: `input` and `change`, as a person would. */
export const fill = (values: Record<string, string>) =>
  Object.entries(values).forEach(([selector, value]) => {
    const input = $<HTMLInputElement>(selector)!;
    input.value = value;
    for (const type of ["input", "change"]) input.dispatchEvent(new Event(type, { bubbles: true }));
  });

export const click = (selector: string) => $(selector)!.click();

const KEYS = { Enter: { key: "Enter", code: "Enter" }, Space: { key: " ", code: "Space" } };
/** A key press on the focused element; what the page did with its keydown. */
export const press = (name: keyof typeof KEYS) => {
  const target = document.activeElement ?? document.body;
  const down = new KeyboardEvent("keydown", { ...KEYS[name], bubbles: true, cancelable: true });
  target.dispatchEvent(down);
  target.dispatchEvent(new KeyboardEvent("keyup", { ...KEYS[name], bubbles: true, cancelable: true }));
  return { key: down.key, prevented: down.defaultPrevented };
};

/** Navigates in the app, as a link would. */
export const push = (href: string) => {
  const link = Object.assign(document.createElement("spa-a"), { hidden: true });
  link.setAttribute("route-href", href);
  document.body.append(link);
  link.click();
  link.remove();
};

type RouteProvision = { previous: { id: string; url: string } };
/** The browser's back button: lands on the previous history entry. */
export const back = () => popstate($<HTMLElement & { provision: RouteProvision }>("spa-manager")!.provision.previous);

// A worker in control, as on every load after the first.
const stubServiceWorker = () =>
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: Object.assign(new EventTarget(), { controller: {}, ready: Promise.resolve({ scope: `${location.origin}/` }) }),
  });

const mount = async (url: string) => {
  // the old page's routes leave the router before it restarts
  document.body.innerHTML = "";
  resetRouter(url);
  for (const { name, value } of INDEX.attributes) document.body.setAttribute(name, value);
  document.body.innerHTML = INDEX.innerHTML;
  await until(() => $("[bind-app][is-active] #me[did-load]")).toBeTruthy();
  await idle();
};

/**
 * Opens the app at `start` on a fresh backend after `setup`, as the Chrome suite's
 * reset and `goto`; `reload(url)` loads the page again. Like there, the test fails
 * on a console error or warning, an unhandled rejection or a failed request, unless
 * `allow` matches it (`/^PATCH \/api\/checkout -> 422$/`).
 */
export const openApp = async (start: string, { setup = [] as Call[], size = SIZES.desktop, allow = [] as RegExp[] } = {}) => {
  const worker = loadWorker();
  for (const call of setup) await worker.api(...call);
  const issues: string[] = [];
  const api = async (request: Request) => {
    const gate = page.gates.find(({ pattern }) => pattern.test(route(request)));
    if (gate) {
      page.inflight--; // held, not in flight
      gate.waiting++;
      await gate.opened;
    }
    return worker.dispatch(request);
  };
  Object.assign(page, { issues, serve: serveStatic(ROOT, { fallback: "index.html", api }) });
  for (const method of ["error", "warn"] as const) {
    vi.spyOn(consoleSinks, method).mockImplementation((...args) => issues.push(`console.${method}: ${args.join(" ")}`));
  }
  const rejections = trackUnhandledRejections();
  onTestFinished(() => {
    rejections.stop();
    const unexpected = [...issues, ...rejections.reasons.map((reason) => `rejection: ${reason}`)];
    expect(unexpected.filter((issue) => !allow.some((pattern) => pattern.test(issue)))).toEqual([]);
  });
  happyDOM.setViewport(size);
  stubServiceWorker();
  await mount(start);
  return { worker, reload: mount };
};

afterEach(async () => {
  page.gates.forEach(({ release }) => release());
  await idle();
  document.body.innerHTML = "";
  Object.assign(page, { issues: [], serve: serveStatic(ROOT, { fallback: "index.html" }) });
  vi.restoreAllMocks();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  resetRouter();
});
// Counts of this polling-driven app suite vary run to run (up to 2x): snapshots are written only on request,
// e.g. `NUCLEUS_COMPLEXITY=1 pnpm test`, and are not committed. After the teardown: after hooks run last-registered first.
if (process?.env.NUCLEUS_COMPLEXITY) trackComplexity(Quark.meter, { settle: idle });
