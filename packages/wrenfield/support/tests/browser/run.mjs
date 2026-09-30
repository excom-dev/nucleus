// Checks the app in headless Chrome at phone and desktop size; one line per check, then a summary.
import { readFileSync } from "node:fs";
import { open, serve, sleep, until } from "./shot.mjs";

const SIZES = { phone: "390x844", desktop: "1280x800" };
const TABLE = { path: "/shop/tables/thorpe-coffee-table", sku: "WF-1014", name: "Thorpe Coffee Table" };
const ANTIQUE = { sku: "WF-1019" };
const BAG = [["POST", "/bag", { sku: TABLE.sku }], ["POST", "/bag", { sku: ANTIQUE.sku }]];
const ORDER = [...BAG, ["PATCH", "/checkout", { delivery: "collect" }], ["POST", "/orders"]];
const TOTALS = { Subtotal: "$7,400", "Trade discount": "$0", Delivery: "Free", Total: "$7,400" };
const SCHEDULE = { "Due today": "$5,600", "Due when ready": "$1,800" };

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
  };
};

// Polls fn in the page until it returns expected.
const expect = async (page, label, fn, expected, ...args) => {
  let actual;
  const matches = async () => JSON.stringify((actual = await page.run(fn, ...args))) === JSON.stringify(expected);
  if (await until(matches, 10_000)) return;
  throw new Error(`${label}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

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

const server = await serve();
const results = [];
for (const [size, viewport] of Object.entries(SIZES)) {
  const init = [`(${helpers})()`];
  const options = { port: server.port, size: viewport, gate: "[bind-app][is-active]", settle: 300, init };
  const page = await open(options).catch((error) => {
    console.log(`Chrome did not start: ${error.message}. It needs Google Chrome (or CHROME) and no sandbox.`);
    process.exit(1);
  });
  await page.goto("/");
  await until(() => page.run(() => !!navigator.serviceWorker.controller), 10_000);
  page.issues();
  for (const check of CHECKS.filter(({ sizes }) => !sizes || sizes.includes(size))) {
    const attempt = async () => {
      await page.run(async (calls) => {
        for (const call of calls) await t.api(...call);
      }, [["DELETE", "/demo"], ...(check.setup ?? [])]);
      await page.goto(check.start);
      await check.run(page);
      const issues = page.issues().filter((issue) => !check.allow?.test(issue));
      if (issues.length) throw new Error(`${issues.length} console or network issue(s), first: ${issues[0]}`);
    };
    const failure = await attempt().then(
      () => null,
      (error) => (page.issues(), error.message.split("\n")[0].slice(0, 300)),
    );
    results.push(!failure);
    console.log(`${failure ? "FAIL" : "pass"}  ${size.padEnd(7)}  ${check.name}${failure ? `: ${failure}` : ""}`);
  }
  await page.close();
}
server.close();
console.log(`browser: ${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
