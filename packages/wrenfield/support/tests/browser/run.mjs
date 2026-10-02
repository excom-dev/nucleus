// Checks the app in headless Chrome at phone and desktop size; one line per check, then a summary. It serves the
// prerendered build as the host does (`_headers`, `_redirects`, 404.html): run `pnpm run build`, then
// `pnpm run build:prerender`, first. Per size, in order:
// - one page per kind hydrates without touching what the server painted, and the server rendered what Chrome renders
//   from the shell the prerender left in `temp/prerender-shell.html` (nucleus-ssr's `checkHydration` and
//   `compareColdRender`, loaded from workspace source, as in the docs site's suite);
// - the app, on a page the service worker controls;
// - the boot, each check needing a worker state of its own, so on a fresh profile.
import { hostHandler, serveSite } from "@excom/vite-plugin-nucleus/host";
import { open, sleep, until } from "@excom/nucleus-test/chrome.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DIST = join(ROOT, "dist");
const SHELL = join(ROOT, "temp/prerender-shell.html");

const SIZES = { phone: "390x844", desktop: "1280x800" };
const TABLE = { path: "/shop/tables/thorpe-coffee-table", sku: "WF-1014", name: "Thorpe Coffee Table" };
const ANTIQUE = { sku: "WF-1019" };
const BAG = [["POST", "/bag", { sku: TABLE.sku }], ["POST", "/bag", { sku: ANTIQUE.sku }]];
const ORDER = [...BAG, ["PATCH", "/checkout", { delivery: "collect" }], ["POST", "/orders"]];
const TOTALS = { Subtotal: "$7,400", "Trade discount": "$0", Delivery: "Free", Total: "$7,400" };
const SCHEDULE = { "Due today": "$5,600", "Due when ready": "$1,800" };
const WORKER = "/service-worker/service-worker.js";

// A hidden or loading state. Cold by design, so not counted: the service worker's /api answers (the person's state,
// kept out of the island), and the views the routes not shown prefetch.
const LOADING = "spa-route[delaying-ready], [is-loading]:not([api-url^='/api/'], spa-route:not([is-active]))";

// A cold page has rendered its route once its spa-manager has; it waits for the kit's loading states too.
const COLD_LOADING = "spa-manager:not([has-rendered])";

// Cold renders of any page: the device's state, which no prerender knows (by attribute name, the value is the
// device's): the layout on <body>, the side a drawer opens from.
const DEVICE = [/^html > body: .*\[data-layout=/, / > content-drawer#[\w-]+: .*\[from-side=/];

// One per route kind. `cold`: what its cold render differs in by design; `status`: its answer, not an issue.
const PAGES = [
  { name: "home", path: "/" },
  { name: "shop", path: "/shop" },
  // model-viewer (third party) writes its AR state
  {
    name: "product",
    path: "/shop/lighting/brass-chandelier-with-glass-drops",
    cold: / > model-viewer\S*: .*\[ar-status=/,
  },
  { name: "account page", path: "/account/story" },
  // 404.html is served (as a 404) for any path; the prerender rendered it as /404
  {
    name: "not found",
    path: "/no-such-page",
    cold: / > spa-manager\S*: .*\[active-url=/,
    status: /no-such-page -> 404$/,
  },
];

// In every document: the readers and actions the checks share.
const helpers = () => {
  const clean = (element) => element?.textContent.trim().replace(/\s+/g, " ");
  window.t = {
    text: (selector) => clean(document.querySelector(selector)),
    // A dl as { term: definition }.
    terms: (selector) => {
      const terms = [...document.querySelectorAll(`${selector} dt`)];
      return Object.fromEntries(terms.map((dt) => [clean(dt), clean(dt.nextElementSibling)]));
    },
    where: () => ({
      url: location.pathname + location.search,
      title: document.title,
      tab: document.querySelector("#tabs > [aria-current]")?.dataset.tab ?? null,
    }),
    api: async (method, path, body) => {
      const init = { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) };
      return (await fetch(`/api${path}`, init)).json();
    },
    // Navigates in the app, as a link would.
    push: async (href) => {
      const link = Object.assign(document.createElement("spa-a"), { hidden: true });
      link.setAttribute("route-href", href);
      document.body.append(link);
      await customElements.whenDefined("spa-a");
      link.click();
      link.remove();
    },
    // Types into each input, keyed by selector.
    fill: (values) => {
      for (const [selector, value] of Object.entries(values)) {
        const input = document.querySelector(selector);
        input.value = value;
        for (const type of ["input", "change"]) input.dispatchEvent(new Event(type, { bubbles: true }));
      }
    },
    focusable: (selector) =>
      [...document.querySelectorAll(`${selector} :is(a[href], button, input, [tabindex])`)].filter(
        (element) => (element.focus(), document.activeElement === element),
      ).length,
    click: (selector) => document.querySelector(selector).click(),
    // The heading of the route shown.
    heading: () => clean(document.querySelector("main spa-route[is-active] h1")),
    // The hydration window closed: kit-utils' state, as nucleus-ssr's checks read it.
    hydrated: () => {
      const state = globalThis[Symbol.for("@excom/kit-utils:hydration")];
      return !!state?.booted && !state.open;
    },
  };
  // Once parsed, before module scripts run: whether a worker controlled the page, and the route's heading.
  document.addEventListener("readystatechange", () => {
    if (document.readyState === "interactive")
      t.parsed = { controlled: !!navigator.serviceWorker?.controller, heading: t.heading() };
  });
};

// Throws unless actual is expected, as JSON.
const equal = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

// Polls fn in the page until it returns expected.
const expect = async (page, label, fn, expected, ...args) => {
  let actual;
  const matches = async () => JSON.stringify((actual = await page.run(fn, ...args))) === JSON.stringify(expected);
  if (!(await until(matches, 10_000))) equal(label, actual, expected);
};

const noIssues = (issues) => {
  if (issues.length) throw new Error(`${issues.length} console or network issue(s), first: ${issues[0]}`);
};

// In the page: where the app is, and the heading of the route shown.
const shown = () => ({ ...t.where(), heading: t.heading() });

// What the host answers for `url`: its status, and whether its body is the untouched shell (rendered by the browser).
const hostAnswer = async (origin, url, shell) => {
  const response = await fetch(`${origin}${url}`);
  return { status: response.status, shell: (await response.text()) === shell };
};

// A live page: the Shop tab moves to the listing in the same document.
const works = async (page) => {
  await page.do(() => {
    window.sameDocument = true;
    t.click("#tabs spa-a[data-tab=shop]");
  });
  const listing = () => ({ ...t.where(), sameDocument: !!window.sameDocument });
  const shop = { url: "/shop", title: "All pieces · Wrenfield", tab: "shop", sameDocument: true };
  await expect(page, "Shop tab", listing, shop);
};

// A load of the TABLE page: once parsed it shows the piece, a worker in control then or not (`controlled`); it ends
// controlled, hydrated and live. A reload marks the document it leaves with `window.reloading`.
const boots = async (page, controlled) => {
  await expect(page, "parsed", () => !window.reloading && t.parsed, { controlled, heading: TABLE.name });
  const state = () => ({ controlled: !!navigator.serviceWorker.controller, hydrated: t.hydrated() });
  await expect(page, "booted", state, { controlled: true, hydrated: true });
  await works(page);
};

// The app's checks, on a page the service worker controls; each starts from the demo's reset state plus `setup`.
const CHECKS = [
  {
    name: "home renders 24 cards and the service worker is in control",
    start: "/",
    run: async (page) => {
      await expect(page, "cards", () => document.querySelectorAll("#home data-product").length, 24);
      await expect(page, "controller", () => !!navigator.serviceWorker.controller, true);
    },
  },
  {
    name: "tab highlight and title follow every route",
    start: "/",
    setup: [["POST", "/bag", { sku: TABLE.sku }], ["POST", "/orders"]],
    run: async (page) => {
      const routes = [
        ["/", "Home · Wrenfield", "home"],
        ["/shop", "All pieces · Wrenfield", "shop"],
        ["/shop/tables", "Tables · Wrenfield", "shop"],
        [TABLE.path, `${TABLE.name} · Wrenfield`, "shop"],
        ["/bag/checkout/details", "Your details · Wrenfield", "bag"],
        ["/account/orders/WF-24001", "Order WF-24001 · Wrenfield", "account"],
        ["/nope", "Not found · Wrenfield", null],
      ];
      for (const [url, title, tab] of routes) {
        if (url !== "/") await page.do((href) => t.push(href), url);
        await expect(page, url, () => t.where(), { url, title, tab });
      }
      await page.do(() => history.back());
      await expect(page, "back", () => t.where(), { url: routes[5][0], title: routes[5][1], tab: routes[5][2] });
    },
  },
  {
    name: "header search follows a query-only change and a reload",
    start: "/shop",
    run: async (page) => {
      const listing = () => ({
        ...t.where(),
        input: document.querySelector("[bind-search] input").value,
        h1: t.text("#shop h1"),
        cards: document.querySelectorAll("#shop [bind-products] > data-product").length,
      });
      const results = (q, cards) => {
        const title = `Results for “${q}”`;
        return { url: `/shop?q=${q}`, title: `${title} · Wrenfield`, tab: "shop", input: q, h1: title, cards };
      };
      const search = async (q) => {
        await page.run((q) => t.fill({ "[bind-search] input": q }), q);
        const link = () => document.querySelector("[bind-search]").getAttribute("route-href");
        await expect(page, `${q} link`, link, `/shop?q=${q}`);
        await page.do(() => document.querySelector("[bind-search] form").requestSubmit());
      };
      await search("oak");
      await expect(page, "oak", listing, results("oak", 9));
      await search("walnut");
      await expect(page, "walnut", listing, results("walnut", 7));
      await page.goto("/shop?q=walnut");
      await expect(page, "reload", listing, results("walnut", 7));
    },
  },
  {
    name: "product price and trade price follow the finish",
    start: TABLE.path,
    setup: [["PATCH", "/session", { isTrade: true }]],
    run: async (page) => {
      const price = () => ({
        finish: document.querySelector("#product data-product").getAttribute("finish-id"),
        price: t.text("#product .price [bind-price]"),
        trade: t.text("#product .price [bind-trade-price]"),
        tradeShown: getComputedStyle(document.querySelector("#product .price [bind-trade-price]")).display !== "none",
      });
      await expect(page, "first", price, { finish: "stone-oak", price: "$3,600", trade: "$3,060", tradeShown: true });
      await page.do(() => [...document.querySelectorAll("#product [bind-finishes] input")].at(-1).click());
      await expect(page, "last", price, { finish: "stone-walnut", price: "$3,880", trade: "$3,298", tradeShown: true });
    },
  },
  {
    name: "add to bag opens the sheet; closed, it holds no focusable control",
    start: TABLE.path,
    run: async (page) => {
      const sheet = () => ({
        open: document.querySelector("#bag-sheet").hasAttribute("is-open"),
        lines: document.querySelectorAll("#bag-sheet data-line").length,
        subtotal: t.text("#bag-sheet [bind-bag=subtotal]"),
      });
      await page.do(() => t.click("#product form[action='/api/bag'] button[type=submit]"));
      await expect(page, "opened", sheet, { open: true, lines: 1, subtotal: "$3,600" });
      await expect(page, "focusable while open", () => t.focusable("#bag-sheet") > 0, true);
      await page.do(() => t.click("#bag-sheet header button[command='--close']"));
      await expect(page, "closed", () => document.querySelector("#bag-sheet").hasAttribute("is-open"), false);
      await expect(page, "focusable when closed", () => t.focusable("#bag-sheet"), 0);
    },
  },
  {
    name: "Enter follows a link; Space presses a button and does not scroll",
    start: "/",
    run: async (page) => {
      const focus = (selector) => {
        const element = document.querySelector(selector);
        element.scrollIntoView({ block: "center" });
        element.focus();
        window.keys = [];
        const record = (event) => keys.push({ key: event.key, prevented: event.defaultPrevented });
        addEventListener("keydown", record, { once: true });
        return document.activeElement === element;
      };
      await expect(page, "focus link", focus, true, "#home spa-a[role=link][route-href='/shop']");
      await page.key("Enter");
      await expect(page, "Enter", () => t.where().url, "/shop");
      await page.goto("/account/story");
      const button = "#story spa-a[role=button][route-href='/account/delivery-returns']";
      await expect(page, "focus button", focus, true, button);
      await page.key("Space");
      const pressed = { url: "/account/delivery-returns", keys: [{ key: " ", prevented: true }] };
      await expect(page, "Space", () => ({ url: t.where().url, keys }), pressed);
    },
  },
  {
    name: "checkout's four steps place an order with the expected totals",
    start: "/bag/checkout/details",
    setup: BAG,
    run: async (page) => {
      const next = () => t.click("main spa-route[is-active] spa-route[is-active] button[type=submit]");
      const summary = () => ({
        url: t.where().url,
        totals: t.terms("#checkout dl.totals"),
        schedule: t.terms("#checkout dl.schedule"),
      });
      await expect(page, "details", () => !!document.querySelector("input[name='contact.name']")?.value, true);
      await page.do(next);
      await expect(page, "delivery", () => t.text("#checkout-delivery input[value=collect] ~ data"), "Free");
      await page.do(() => t.click("#checkout-delivery input[value=collect]"));
      await page.do(next);
      await expect(page, "payment", () => t.where().url, "/bag/checkout/payment");
      await page.do(next);
      await expect(page, "review", summary, { url: "/bag/checkout/review", totals: TOTALS, schedule: SCHEDULE });
      await expect(page, "review delivery", () => t.text("#checkout-review [bind-bag=deliveryFee]"), "Free");
      await page.do(next);
      const placed = () => ({
        url: t.where().url,
        id: t.text("#checkout-complete [bind-order=id]"),
        schedule: t.terms("#checkout-complete dl.schedule"),
      });
      await expect(page, "complete", placed, { url: "/bag/checkout/complete", id: "WF-24001", schedule: SCHEDULE });
    },
  },
  {
    name: "typed details survive a refused step",
    start: "/bag/checkout/details",
    setup: BAG,
    allow: /PATCH \S+\/api\/checkout -> 422$/,
    run: async (page) => {
      const submit = (values) => (t.fill(values), t.click("#checkout-details button[type=submit]"));
      const form = () => ({
        url: t.where().url,
        name: document.querySelector("input[name='contact.name']").value,
        invalid: document.querySelector("input[name='contact.email']").getAttribute("aria-invalid"),
      });
      const saved = async () => ({ url: t.where().url, name: (await t.api("GET", "/checkout")).contact.name });
      await expect(page, "details", () => !!document.querySelector("input[name='contact.name']")?.value, true);
      await page.do(submit, { "[name='contact.name']": "Typed Name", "[name='contact.email']": "" });
      await expect(page, "refused", form, { url: "/bag/checkout/details", name: "Typed Name", invalid: "true" });
      await page.do(submit, { "[name='contact.email']": "typed@example.com" });
      await expect(page, "accepted", saved, { url: "/bag/checkout/delivery", name: "Typed Name" });
    },
  },
  {
    name: "order page and account list show money",
    start: "/account/orders/WF-24001",
    setup: ORDER,
    run: async (page) => {
      const order = () => ({ totals: t.terms("#order dl.totals"), schedule: t.terms("#order dl.schedule") });
      const orders = () =>
        [...document.querySelectorAll("#account [bind-orders] li")].map((li) =>
          ["[bind-item=id]", "[bind-order-total]"].map((selector) => li.querySelector(selector).textContent),
        );
      await expect(page, "order", order, { totals: TOTALS, schedule: SCHEDULE });
      await page.do(() => t.push("/account"));
      await expect(page, "account", orders, [["WF-24001", "$7,400"]]);
    },
  },
  {
    name: "back to a scrolled shop list restores its offset",
    start: "/shop",
    run: async (page) => {
      const where = () => ({ url: t.where().url, y: Math.round(scrollY) });
      const openCard = () => {
        const cards = [...document.querySelectorAll("#shop spa-a[bind-product-link]")];
        cards.find((card) => card.getBoundingClientRect().top > 100).click();
      };
      await expect(page, "list", () => document.querySelectorAll("#shop [bind-products] > data-product").length, 44);
      await page.run(() => scrollTo(0, 2400));
      await expect(page, "scrolled", where, { url: "/shop", y: 2400 });
      await page.do(openCard);
      await expect(page, "product", () => !!document.querySelector("#product h1")?.textContent, true);
      await page.do(() => history.back());
      await expect(page, "back", where, { url: "/shop", y: 2400 });
      await sleep(1000);
      await expect(page, "held", where, { url: "/shop", y: 2400 });
    },
  },
  {
    name: "a reload is controlled from the start and hydrates",
    start: TABLE.path,
    run: async (page) => {
      await page.run(() => (window.reloading = true));
      await page.cdp("Page.reload", {});
      await boots(page, true);
    },
  },
  {
    name: "the person's pages answer the shell and render on the client",
    start: "/",
    run: async (page, { served, shell }) => {
      const routes = [
        ["/bag", "Bag", "bag"],
        ["/saved", "Saved", "saved"],
        ["/account", "Account", "account"],
      ];
      for (const [url, heading, tab] of routes) {
        equal(url, await hostAnswer(served, url, shell), { status: 200, shell: true });
        await page.goto(url);
        await expect(page, url, shown, { url, title: `${heading} · Wrenfield`, tab, heading });
      }
    },
  },
  {
    name: "an order link answers the order shell and shows the order",
    start: "/account/orders/WF-24001",
    setup: [["POST", "/bag", { sku: TABLE.sku }], ["POST", "/orders"]],
    run: async (page, { served, shell }) => {
      // no file of its own: `_redirects` serves the order shell
      equal("answer", await hostAnswer(served, "/account/orders/WF-24001", shell), { status: 200, shell: true });
      const order = { url: "/account/orders/WF-24001", title: "Order WF-24001 · Wrenfield", tab: "account" };
      await expect(page, "order", shown, { ...order, heading: "Order WF-24001" });
    },
  },
  {
    name: "an unknown URL answers 404 with the not-found page",
    start: "/no-such-page",
    allow: /no-such-page -> 404$/,
    run: async (page, { served, shell }) => {
      equal("answer", await hostAnswer(served, "/no-such-page", shell), { status: 404, shell: false });
      const notFound = { url: "/no-such-page", title: "Not found · Wrenfield", tab: null, heading: "Not on display" };
      await expect(page, "page", shown, notFound);
    },
  },
  {
    name: "a filtered shop link ends on the filtered list",
    // the prerendered /shop is unfiltered: the worker's answer filters it
    start: "/shop?era=antique",
    run: async (page) => {
      const listing = () => ({
        ...t.where(),
        h1: t.text("#shop h1"),
        cards: document.querySelectorAll("#shop [bind-products] > data-product").length,
      });
      const antiques = { url: "/shop?era=antique", title: "Antiques · Wrenfield", tab: "shop", h1: "Antiques" };
      await expect(page, "antiques", listing, { ...antiques, cards: 25 });
    },
  },
  {
    name: "backend scenarios pass in the service worker",
    start: "/",
    sizes: ["desktop"],
    allow: /\/api\/\S+ -> 4\d\d( \(x\d+\))?$/,
    run: async (page) => {
      const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
      await page.run(`${source("../backend/scenario.js")}\n${source("browser.js")}`);
      await until(() => page.run(() => !!window.scenarioResult), 120_000, 500);
      const result = await page.run(() => window.scenarioResult);
      if (!result) throw new Error("no result in 120 s");
      const [first] = result.failed;
      if (first) throw new Error(`${result.passed}/${result.total}, first failure: ${first.name}`);
    },
  },
];

// Origins of the boot checks, each with a worker state of its own: the build as the host serves it, `intercept(url)`
// answering first.
const REFUSED = { status: 404, type: "text/plain; charset=utf-8", body: "Refused by the browser checks" };
const VARIANTS = {
  noWorker: ({ pathname }) => pathname === WORKER && REFUSED,
  // the old site's worker URL, with the same backend
  oldWorker: ({ pathname }) =>
    pathname === "/sw.js" && {
      status: 200,
      type: "text/javascript; charset=utf-8",
      body: `importScripts("${WORKER}");`,
    },
};

// The boot, each check on a fresh profile, on its `origin` (VARIANTS; the build as served by default). `allow`: the
// issues the check causes.
const BOOT = [
  {
    // no worker yet
    name: "a first visit shows the prerendered page, then the worker takes control and it works",
    run: async (page) => {
      await page.goto(TABLE.path);
      await boots(page, false);
    },
  },
  {
    // a kit that never arrives, blocked by URL (bundled in a local build, from unpkg in a deploy build)
    name: "a form in the prerendered page does not submit before the kit loads",
    allow: /nucleus-kit\.progressive/,
    run: async (page) => {
      await page.cdp("Network.setBlockedURLs", { urls: ["*nucleus-kit.progressive*"] });
      await page.goto(TABLE.path);
      await page.do(() => {
        window.stayed = true;
        addEventListener("submit", (event) => (window.prevented = event.defaultPrevented));
        t.click("#product form[action='/api/bag'] button[type=submit]");
      });
      const submitted = () => ({
        kit: !!customElements.get("super-form"),
        prevented: window.prevented ?? null,
        stayed: !!window.stayed,
        url: t.where().url,
      });
      await expect(page, "submitted", submitted, { kit: false, prevented: true, stayed: true, url: TABLE.path });
    },
  },
  {
    // an active worker the reload bypasses (`ignoreCache` is Shift+Reload)
    name: "a hard reload is claimed by the worker and the page works",
    run: async (page) => {
      await page.goto(TABLE.path);
      await expect(page, "first visit", () => !!navigator.serviceWorker.controller, true);
      await page.run(() => (window.reloading = true));
      await page.cdp("Page.reload", { ignoreCache: true });
      await boots(page, false);
    },
  },
  {
    // a worker the browser cannot register
    name: "a refused service worker leaves no controller and shows the splash",
    origin: "noWorker",
    allow: /\/service-worker\/service-worker\.js/,
    run: async (page) => {
      await page.goto("/");
      const splash = () => ({
        controlled: !!navigator.serviceWorker.controller,
        needsWorker: document.body.hasAttribute("needs-service-worker"),
        splash: getComputedStyle(document.querySelector("body > [role=status]")).visibility,
      });
      await expect(page, "splash", splash, { controlled: false, needsWorker: true, splash: "visible" });
    },
  },
  {
    // the old site's worker, registered from a file of the site (no boot script there)
    name: "a worker registered from the old /sw.js gives way to the new one",
    origin: "oldWorker",
    run: async (page) => {
      await page.goto("/img/logo.svg");
      await page.run(async () => {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      });
      const active = async () =>
        (await navigator.serviceWorker.getRegistration())?.active?.scriptURL.replace(location.origin, "");
      await expect(page, "old worker", active, "/sw.js");
      // an image document names no icon: Chrome asked for /favicon.ico
      page.issues();
      await page.goto("/");
      const moved = async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const url = (worker) => worker?.scriptURL.replace(location.origin, "");
        const { installing, waiting, active } = registrations[0] ?? {};
        return {
          controller: url(navigator.serviceWorker.controller),
          registrations: registrations.length,
          // where a worker that has not taken over is
          ...(url(installing) && { installing: `${url(installing)} ${installing.state}` }),
          ...(url(waiting) && { waiting: `${url(waiting)} ${waiting.state}` }),
          ...(url(active) !== url(navigator.serviceWorker.controller) && { active: url(active) }),
        };
      };
      // Chrome activates a waiting worker once the one in control is idle: at once, or (when a request was in
      // flight as it finished installing) by the next navigation
      if (!(await until(async () => (await page.run(moved)).controller === WORKER, 5000))) await page.goto("/");
      await expect(page, "moved", moved, { controller: WORKER, registrations: 1 });
      await works(page);
    },
  },
];

// A cold render's differences, one line each, as `allow` patterns read them (the first 20 of each kind).
const differences = ({ serverOnly, browserOnly, different }) =>
  [...serverOnly, ...browserOnly, ...different].map(
    ({ path, server, browser }) => `${path}: server ${server}, browser ${browser}`,
  );

// nucleus-kit's elements that read the device or the person: its server entry defines elements, so it
// loads in a window, as in the prerender. The same as the docs site's suite.
const clientOnlyTags = async (runner) => {
  const { createDom, installGlobals } = await runner.import("@excom/nucleus-dom");
  const dom = createDom();
  const restore = installGlobals(dom.window);
  try {
    return [...(await runner.import("@excom/nucleus-kit/server")).SERVER_EXCLUDED_TAGS];
  } finally {
    restore();
    await dom.dispose();
  }
};

// The build in `DIST` as the host serves it, but `intercept(url)` answers first when it returns { status, type, body }.
const serveVariant = async (intercept) => {
  const host = hostHandler(DIST);
  const server = createServer((req, res) => {
    const answer = intercept(new URL(req.url, "http://localhost"));
    if (!answer) return host(req, res);
    res.writeHead(answer.status, { "content-type": answer.type, "cache-control": "no-store" });
    res.end(answer.body);
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(0, ok));
  return { port: server.address().port, close: () => (server.closeAllConnections(), server.close()) };
};

if (import.meta.main) {
  // every prerendered page answered with the untouched shell: the route renders as on a site never prerendered
  const coldServer = await serveSite({ root: DIST, shell: SHELL }).catch((error) => {
    console.log(error.message);
    process.exit(1);
  });
  const server = await serveSite({ root: DIST });
  const variants = Object.fromEntries(
    await Promise.all(Object.entries(VARIANTS).map(async ([name, intercept]) => [name, await serveVariant(intercept)])),
  );
  // workspace source, as the prerender loads it: no build of nucleus-ssr needed
  const { createWorkspaceRunner } = await import("@excom/heft-rig/scripts/prerender.mjs");
  const runner = await createWorkspaceRunner(ROOT);
  const { checkHydration, compareColdRender } = await runner.import("@excom/nucleus-ssr/testing");
  const clientOnly = await clientOnlyTags(runner);
  const [served, cold] = [server, coldServer].map(({ port }) => `http://localhost:${port}`);
  const site = { served, shell: readFileSync(SHELL, "utf8") };
  const init = [`(${helpers})()`];
  const results = [];
  const line = (failure, size, text) =>
    console.log(`${failure ? "FAIL" : "pass"}  ${size.padEnd(7)}  ${text}${failure ? `: ${failure}` : ""}`);
  // null, or the first line of why (the page's issues so far dropped); counted
  const outcome = async (page, attempt) => {
    const failure = await attempt().then(
      () => null,
      (error) => (page?.issues(), error.message.split("\n")[0].slice(0, 600)),
    );
    results.push(!failure);
    return failure;
  };
  for (const [size, viewport] of Object.entries(SIZES)) {
    const options = { port: server.port, size: viewport, gate: "#me[did-load]", settle: 300, init };
    const page = await open(options).catch((error) => {
      console.log(`Chrome did not start: ${error.message}. It needs Google Chrome (or CHROME) and no sandbox.`);
      process.exit(1);
    });
    // the first visit to each origin installs its service worker
    for (const origin of [served, cold]) {
      await page.goto(`${origin}/`);
      await until(() => page.run(() => !!navigator.serviceWorker.controller), 10_000);
    }
    // first, while the person's state is a first visit's, which the prerender rendered
    for (const { name, path, cold: coldAllow, status } of PAGES) {
      const issuesOf = () => page.issues().filter((issue) => !status?.test(issue));
      let flips = 0;
      const failure = await outcome(page, async () => {
        page.issues();
        const report = await checkHydration(page, path, { loading: LOADING });
        flips = report.flips;
        const { changes } = report;
        if (changes.length) throw new Error(`${changes.length} change(s): ${changes.slice(0, 5).join(" | ")}`);
        noIssues(issuesOf());
      });
      line(failure, size, `${name} (${path})${flips ? ` [${flips} attribute flip(s) between frames]` : ""}`);
      // the same route rendered by Chrome from the shell, against the prerendered file
      let lazy = 0;
      const coldFailure = await outcome(page, async () => {
        page.issues();
        const allow = [...DEVICE, ...(coldAllow ? [coldAllow] : [])];
        const report = await compareColdRender(page, path, { served, cold, loading: COLD_LOADING, clientOnly, allow });
        lazy = report.lazyViews;
        const { serverOnly, browserOnly, different } = report.counts;
        if (serverOnly + browserOnly + different) {
          const counts = `${serverOnly} server only, ${browserOnly} browser only, ${different} different`;
          throw new Error(`${counts}: ${differences(report).slice(0, 3).join(" | ")}`);
        }
        noIssues(issuesOf());
      });
      const lazyViews = lazy ? ` [${lazy} lazy view(s) not in view, not compared]` : "";
      line(coldFailure, size, `cold render: ${name} (${path})${lazyViews}`);
    }
    // the checks set their state through the app's API, from a page of its origin
    await page.goto("/");
    page.issues();
    for (const check of CHECKS.filter(({ sizes }) => !sizes || sizes.includes(size))) {
      const failure = await outcome(page, async () => {
        await page.run(async (calls) => {
          for (const call of calls) await t.api(...call);
        }, [["DELETE", "/demo"], ...(check.setup ?? [])]);
        await page.goto(check.start);
        await check.run(page, site);
        noIssues(page.issues().filter((issue) => !check.allow?.test(issue)));
      });
      line(failure, size, check.name);
    }
    await page.close();
    for (const check of BOOT) {
      let fresh;
      const failure = await outcome(undefined, async () => {
        fresh = await open({ port: (variants[check.origin] ?? server).port, size: viewport, settle: 300, init });
        await check.run(fresh);
        noIssues(fresh.issues().filter((issue) => !check.allow?.test(issue)));
      });
      await fresh?.close();
      line(failure, size, check.name);
    }
  }
  for (const { close } of [server, coldServer, ...Object.values(variants)]) close();
  await runner.close();
  console.log(`browser: ${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
}
