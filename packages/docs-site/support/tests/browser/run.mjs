// Checks in headless Chrome that prerendered pages hydrate without touching what the server painted, and
// that a hydrated page then navigates on the client: one line per page and size, then a summary. Run after
// `build:prerender`, from the package directory:
//
//   node support/tests/browser/run.mjs [--detail] [--throttle <rate>]
//
// --detail lists, under each failing page, every change by kind with its count and three examples.
// --throttle slows the CPU by <rate> (4 is a mid-range phone): frames then land in gaps a fast machine hides.
// A server attribute counts when a painted frame lacks it or it is still gone at the end; one that goes and
// returns between two frames is never seen, and is only counted ("flips").
// The owner approves every run, as for the wrenfield suite (whose Chrome harness this reuses).
import { fileURLToPath } from "node:url";
import { open, until } from "../../../../wrenfield/support/tests/browser/shot.mjs";
import { servePages } from "@excom/heft-rig/scripts/pages.mjs";

const DIST = fileURLToPath(new URL("../../../dist", import.meta.url));
const DETAIL = process.argv.includes("--detail");
const THROTTLE = Number(process.argv[process.argv.indexOf("--throttle") + 1]) || 0;
const SIZES = { phone: "390x844", desktop: "1280x800" };

// A hidden or loading state. Cold by design, so not counted: the service worker's /api answers (client
// state, never in the island) and the views an idle `pre-fetch` include loads.
const LOADING = "spa-route[delaying-ready], [is-loading]:not([api-url^='/api/'], include-content[pre-fetch])";

// A playground (live-app) unpauses and renders its editors and preview on the client, once its
// service-worker observer mounts: never in a prerender.
const PLAYGROUND = /^added: .*live-app|^(attribute removed|frame showed): .*live-app.* \[is-paused\]$/;

// Changes on any page, known and reported: a demo's "Live document" tab is a text copy of the live DOM,
// whose Quark `q-scope` ids differ per page load.
const KNOWN = [/live-state/];

// One per route kind. `allow`: changes the page makes by design, matched against each reported line.
const PAGES = [
  { name: "home (company page)", path: "/" },
  { name: "docs home", path: "/nucleus", allow: PLAYGROUND },
  { name: "package README", path: "/nucleus/packages/quark" },
  { name: "package doc page", path: "/nucleus/packages/neutron/props" },
  { name: "site guide", path: "/nucleus/docs/quick_start" },
  { name: "example", path: "/nucleus/examples/counter", allow: PLAYGROUND },
  // 404.html is served (as a 404) for any path; it names the one that matched nothing
  { name: "not found", path: "/nucleus/no-such-page", allow: /bind-path/, status: /no-such-page -> 404$/ },
];

// In every document, before its scripts: from the end of parsing (readyState "interactive", before module
// scripts run) it records what hydration does to the server's DOM, every frame until `hydration.done`.
const recorder = (loading) => {
  // kit-utils' momentary `:scope` id and the claimed provision id are expected to go
  const IGNORED = /^(n-ssr$|n-util-select-id-)/;
  const record = (window.hydration = { changes: [], frames: [], flips: 0, transitions: 0, start: 0, done: false });
  // server attributes gone right now, by element
  const missing = new Map();
  const gone = () => [...missing].flatMap(([element, names]) => [...names].map((name) => [element, name]));
  const step = (node) =>
    node.nodeType !== 1
      ? node.nodeName
      : `${node.localName}${node.id ? `#${node.id}` : ""}${[...node.attributes]
          .filter(({ name }) => name.startsWith("bind-") || name === "class" || name === "api-url")
          .map(({ name, value }) => (value ? `[${name}="${value}"]` : `[${name}]`))
          .join("")}`;
  const path = (node) => {
    const steps = [];
    for (let at = node; at && at !== document; at = at.parentNode) steps.unshift(step(at));
    return steps.join(" > ");
  };
  const start = () => {
    const server = new WeakSet();
    const attributes = new WeakMap();
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      server.add(node);
      if (node.nodeType === 1) attributes.set(node, new Set(node.getAttributeNames()));
    }
    record.start = performance.now();
    // a prerendered page keeps it: its first update must not animate, delay or scroll
    record.rendered = !!document.querySelector("spa-manager[has-rendered]");
    new MutationObserver((records) => {
      for (const { type, target, removedNodes, addedNodes, attributeName } of records) {
        if (type === "childList") {
          for (const node of removedNodes) if (server.has(node)) record.changes.push(`removed: ${path(target)} > ${step(node)}`);
          // the head gets the bundler's module preloads; anything else added counts
          for (const node of addedNodes) if (target !== document.head) record.changes.push(`added: ${path(target)} > ${step(node)}`);
        } else if (type === "characterData" && server.has(target)) {
          record.changes.push(`text: ${path(target.parentNode)}`);
        } else if (type === "attributes" && attributes.get(target)?.has(attributeName) && !IGNORED.test(attributeName)) {
          const names = missing.get(target) ?? new Set();
          if (target.hasAttribute(attributeName)) names.delete(attributeName);
          else if (!names.has(attributeName)) (names.add(attributeName), record.flips++);
          if (names.size) missing.set(target, names);
          else missing.delete(target);
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    // observer callbacks run before a frame's callbacks, so `missing` is what this frame paints
    const frame = () => {
      const shown = document.querySelector(loading);
      if (shown) record.frames.push(path(shown));
      for (const [element, name] of gone()) record.frames.push(`${path(element)} without [${name}]`);
      if (!record.done) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    record.gone = () => gone().map(([element, name]) => `attribute removed: ${path(element)} [${name}]`);
  };
  const transition = Document.prototype.startViewTransition;
  if (transition) {
    Document.prototype.startViewTransition = function (...args) {
      record.transitions++;
      return transition.apply(this, args);
    };
  }
  document.addEventListener("readystatechange", () => document.readyState === "interactive" && start());
};

// Changes by kind (an attribute by its name, a node by what it is), most frequent first.
const grouped = (changes) => {
  const kinds = new Map();
  for (const line of changes) {
    const kind = line.startsWith("attribute removed")
      ? `attribute removed ${line.slice(line.lastIndexOf("["))}`
      : line.includes(" without [")
        ? `frame showed: an element without ${line.slice(line.lastIndexOf("["))}`
        : `${line.slice(0, line.indexOf(":"))}: ${line.slice(line.lastIndexOf(" > ") + 3).replace(/[#[].*$/, "")}`;
    kinds.set(kind, [...(kinds.get(kind) ?? []), line]);
  }
  return [...kinds]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([kind, lines]) => `    ${String(lines.length).padStart(4)} x ${kind}\n${lines.slice(0, 3).map((line) => `           ${line}`).join("\n")}`);
};

// The hydration window closed (kit-utils' global state), nothing hidden or loading, Quark settled.
const hydrated = async (loading) => {
  const state = globalThis[Symbol.for("@excom/kit-utils:hydration")];
  if (!state?.booted || state.open) return false;
  if (document.querySelector(loading)) return false;
  await document.querySelector("quark-sheet")?.quarkInstance?.constructor.whenSettled?.();
  return true;
};

// What hydration did, once it is over: changes, server attributes still gone, frames that showed a hidden
// or loading state or lacked a server attribute, View Transitions, and requests made since parsing ended,
// other than stylesheets, sheets and modules (views that an idle `pre-fetch` include loads are cold by design).
const report = () => {
  hydration.done = true;
  const idle = [...document.querySelectorAll("include-content[pre-fetch]")].map((el) => el.getAttribute("template-ref"));
  const requests = performance
    .getEntriesByType("resource")
    .filter(({ startTime }) => startTime >= hydration.start)
    .map(({ name }) => new URL(name).pathname)
    .filter((path) => /^\/(views|package-metas)\//.test(path) && !idle.includes(path) && !/\.(css|quark|js)$/.test(path));
  return {
    flips: hydration.flips,
    changes: [
      ...(hydration.rendered ? [] : ["server markup: spa-manager without has-rendered"]),
      ...hydration.changes,
      ...hydration.gone(),
      ...[...new Set(hydration.frames)].map((path) => `frame showed: ${path}`),
      ...(hydration.transitions ? [`view transitions: ${hydration.transitions}`] : []),
      ...requests.map((path) => `request: ${path}`),
    ],
  };
};

const server = await servePages({ root: DIST });
const results = [];
for (const [size, viewport] of Object.entries(SIZES)) {
  const init = [`(${recorder})(${JSON.stringify(LOADING)})`];
  const page = await open({ port: server.port, size: viewport, settle: 300, init }).catch((error) => {
    console.log(`Chrome did not start: ${error.message}. It needs Google Chrome (or CHROME) and no sandbox.`);
    process.exit(1);
  });
  if (THROTTLE) await page.cdp("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  // the first visit installs the service worker the playgrounds and the demos' /api calls need
  await page.goto("/");
  await until(() => page.run(() => !!navigator.serviceWorker.controller), 10_000);
  page.issues();
  for (const { name, path, allow, status } of PAGES) {
    let flips = 0;
    const attempt = async () => {
      await page.goto(path);
      if (!(await until(() => page.run(hydrated, LOADING), 15_000))) throw new Error("still hydrating after 15 s");
      const reported = await page.run(report);
      flips = reported.flips;
      const changes = reported.changes.filter((line) => !allow?.test(line) && !KNOWN.some((known) => known.test(line)));
      const issues = page.issues().filter((issue) => !status?.test(issue));
      if (changes.length) {
        const error = new Error(`${changes.length} change(s): ${changes.slice(0, 5).join(" | ")}`);
        throw Object.assign(error, { changes });
      }
      if (issues.length) throw new Error(`${issues.length} console or network issue(s), first: ${issues[0]}`);
    };
    let detail = [];
    const failure = await attempt().then(
      () => null,
      (error) => (page.issues(), (detail = grouped(error.changes ?? [])), error.message.split("\n")[0].slice(0, 600)),
    );
    results.push(!failure);
    const between = flips ? ` [${flips} attribute flip(s) between frames]` : "";
    console.log(`${failure ? "FAIL" : "pass"}  ${size.padEnd(7)}  ${name} (${path})${between}${failure ? `: ${failure}` : ""}`);
    if (DETAIL && detail.length) console.log(detail.join("\n"));
  }
  // A hydrated page is live: a nav link moves to another page in the same document, which then renders.
  const navigate = async () => {
    await page.goto("/nucleus/packages/quark");
    if (!(await until(() => page.run(hydrated, LOADING), 15_000))) throw new Error("still hydrating after 15 s");
    await page.do(() => {
      window.sameDocument = true;
      document.querySelector('spa-a[route-href="/nucleus/packages/neutron"]').click();
    });
    const shown = () =>
      page.run(() => ({
        sameDocument: !!window.sameDocument,
        path: location.pathname,
        heading: document.querySelector("spa-route[is-active] h1")?.textContent.trim(),
      }));
    const arrived = ({ sameDocument, path, heading }) =>
      sameDocument && path === "/nucleus/packages/neutron" && heading === "neutron";
    if (!(await until(async () => arrived(await shown()), 10_000))) throw new Error(JSON.stringify(await shown()));
    const issues = page.issues();
    if (issues.length) throw new Error(`${issues.length} console or network issue(s), first: ${issues[0]}`);
  };
  const failure = await navigate().then(
    () => null,
    (error) => (page.issues(), error.message.split("\n")[0].slice(0, 600)),
  );
  results.push(!failure);
  console.log(`${failure ? "FAIL" : "pass"}  ${size.padEnd(7)}  client navigation from a hydrated page${failure ? `: ${failure}` : ""}`);
  await page.close();
}
server.close();
console.log(`browser: ${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
