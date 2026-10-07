// Checks in headless Chrome that prerendered pages hydrate without touching what the server painted, that
// the server rendered what a browser renders from the shell (the cold render), and that a hydrated page
// then navigates on the client: one line per page, check and size, then a summary. Run after
// `build:prerender`, from the package directory:
//
//   node support/tests/browser/run.mjs [--detail] [--throttle <rate>]
//
// --detail lists, under each failing page, every change by kind with its count and three examples, and the
// differences a cold render kept.
// --throttle slows the CPU by <rate> (4 is a mid-range phone): frames then land in gaps a fast machine hides.
// The checks are nucleus-ssr's `checkHydration` and `compareColdRender`, loaded from workspace source; the
// cold render is served the shell the prerender left in `temp/prerender-shell.html`.
// The owner approves every run, as for the wrenfield suite (both run on nucleus-test's chrome.mjs).
import { serveSite } from "@excom/vite-plugin-nucleus/host";
import { open, until } from "@excom/nucleus-test/chrome.mjs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SIZES = { phone: "390x844", desktop: "1280x800" };

// A hidden or loading state (a `no-ssr` region's are left out). Cold by design, so not counted: the service
// worker's /api answers (client state, never in the island) and the views an idle `pre-fetch` include loads.
const LOADING = "spa-route[delaying-ready], [is-loading]:not([api-url^='/api/'], include-content[pre-fetch])";

// A cold page has rendered its route once its spa-manager has; it waits for the kit's loading states too.
const COLD_LOADING = "spa-manager:not([has-rendered])";

// Requests that count when a hydrated page makes them: content the island answers.
const REQUESTS = /^\/(views|package-metas)\//;

// A playground (live-app) unpauses and renders its editors and preview on the client, once its
// service-worker observer mounts: never in a prerender. In a cold render: inside it, what the browser
// adds, and the `is-paused` it drops.
const PLAYGROUND = /^added: .*live-app|^(attribute removed|frame showed): .*live-app.* \[is-paused\]$/;
const PLAYGROUND_COLD = / > article\[class="live-app"\]( > .*)?: server (nothing|\[is-paused\]), browser /;

// Changes on any page, known and reported: a demo's "Live document" tab is a text copy of the live DOM,
// whose Quark `q-scope` ids differ per page load.
const KNOWN = [/live-state/];

// Cold renders of any page: the canonical link, `og:url` and markdown link the prerender's `afterRender`
// adds to a routed page.
const SEO =
  /^html > head: server <(link rel="canonical"|meta property="og:url"|link rel="alternate" type="text\/markdown")/;

// ...and the release notice, which opens on a timer for a person who has not seen it: on a slow page, before
// the comparison.
const NOTICE = / > content-drawer#release-notice: server nothing, browser \[(is-open|data-did-open)\]$/;

// One per route kind. `allow`: changes the page makes by design, matched against each reported line;
// `cold`: the same for its cold render.
const PAGES = [
  { name: "docs home", path: "/", allow: PLAYGROUND, cold: PLAYGROUND_COLD },
  { name: "package README", path: "/packages/quark" },
  // an element's page adds the API reference view and demos: `no-ssr`, so the browser fetches their view
  {
    name: "element README",
    path: "/packages/include-content",
    allow: /^request: \/views\/live-demo\/live-demo\.html$/,
  },
  { name: "package doc page", path: "/packages/neutron/props" },
  { name: "site guide", path: "/docs/quick_start" },
  { name: "example", path: "/examples/counter", allow: PLAYGROUND, cold: PLAYGROUND_COLD },
  // 404.html is served (as a 404) for any path; it names the one that matched nothing, which the
  // prerender rendered as /404
  {
    name: "not found",
    path: "/no-such-page",
    allow: /bind-path/,
    cold: /bind-path|\[active-url=/,
    status: /no-such-page -> 404$/,
  },
];

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

const KINDS = { serverOnly: "server only", browserOnly: "browser only", different: "different" };

// A cold render's differences, one line each, by kind: what it kept of each (the first 20).
const coldLines = (report) =>
  Object.entries(KINDS).flatMap(([kind, title]) =>
    report[kind].map(({ path, server, browser }) => `${title}: ${path}: server ${server}, browser ${browser}`),
  );

// The same by kind, with how many there are of each.
const coldDetail = (report) =>
  Object.entries(KINDS)
    .filter(([kind]) => report.counts[kind])
    .map(([kind, title]) => {
      const lines = report[kind].map(({ path, server, browser }) => `           ${path}: server ${server}, browser ${browser}`);
      return `    ${String(report.counts[kind]).padStart(4)} x ${title}\n${lines.join("\n")}`;
    });

// nucleus-kit's elements that read the device or the person: its server entry defines elements, so it
// loads in a window, as in the prerender.
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

if (import.meta.main) {
  const DETAIL = process.argv.includes("--detail");
  const THROTTLE = Number(process.argv[process.argv.indexOf("--throttle") + 1]) || 0;
  // every prerendered page answered with the untouched shell: the route renders as on a site never prerendered
  const coldServer = await serveSite({ root: join(ROOT, "dist"), shell: join(ROOT, "temp/prerender-shell.html") }).catch(
    (error) => {
      console.log(error.message);
      process.exit(1);
    },
  );
  const server = await serveSite({ root: join(ROOT, "dist") });
  // workspace source, as the prerender loads it: no build of nucleus-ssr needed
  const { createWorkspaceRunner } = await import("@excom/heft-rig/scripts/prerender.mjs");
  const runner = await createWorkspaceRunner(ROOT);
  const { checkHydration, compareColdRender } = await runner.import("@excom/nucleus-ssr/testing");
  const clientOnly = await clientOnlyTags(runner);
  const [served, cold] = [server, coldServer].map(({ port }) => `http://localhost:${port}`);
  const results = [];
  let page;
  const line = (failure, size, text) =>
    console.log(`${failure ? "FAIL" : "pass"}  ${size.padEnd(7)}  ${text}${failure ? `: ${failure}` : ""}`);
  const failureOf = (error) => (page.issues(), error.message.split("\n")[0].slice(0, 600));
  for (const [size, viewport] of Object.entries(SIZES)) {
    page = await open({ port: server.port, size: viewport, settle: 300 }).catch((error) => {
      console.log(`Chrome did not start: ${error.message}. It needs Google Chrome (or CHROME) and no sandbox.`);
      process.exit(1);
    });
    if (THROTTLE) await page.cdp("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    // the first visit to each site installs the service worker the playgrounds and the demos' /api calls need
    for (const origin of [served, cold]) {
      await page.goto(`${origin}/`);
      await until(() => page.run(() => !!navigator.serviceWorker.controller), 10_000);
    }
    for (const { name, path, allow, cold: coldAllow, status } of PAGES) {
      const issuesOf = () => page.issues().filter((issue) => !status?.test(issue));
      let flips = 0;
      const attempt = async () => {
        page.issues();
        const report = await checkHydration(page, path, {
          loading: LOADING,
          allow: [...KNOWN, ...(allow ? [allow] : [])],
          requests: REQUESTS,
        });
        flips = report.flips;
        const { changes } = report;
        const issues = issuesOf();
        if (changes.length) {
          const error = new Error(`${changes.length} change(s): ${changes.slice(0, 5).join(" | ")}`);
          throw Object.assign(error, { changes });
        }
        if (issues.length) throw new Error(`${issues.length} console or network issue(s), first: ${issues[0]}`);
      };
      let detail = [];
      const failure = await attempt().then(
        () => null,
        (error) => ((detail = grouped(error.changes ?? [])), failureOf(error)),
      );
      results.push(!failure);
      const between = flips ? ` [${flips} attribute flip(s) between frames]` : "";
      line(failure, size, `${name} (${path})${between}`);
      if (DETAIL && detail.length) console.log(detail.join("\n"));
      // the same route rendered by Chrome from the shell, against the prerendered file
      let lazy = 0;
      const coldAttempt = async () => {
        page.issues();
        const report = await compareColdRender(page, path, {
          served,
          cold,
          loading: COLD_LOADING,
          clientOnly,
          allow: [SEO, NOTICE, ...(coldAllow ? [coldAllow] : [])],
        });
        lazy = report.lazyViews;
        const issues = issuesOf();
        const { serverOnly, browserOnly, different } = report.counts;
        if (serverOnly + browserOnly + different) {
          const counts = `${serverOnly} server only, ${browserOnly} browser only, ${different} different`;
          const error = new Error(`${counts}: ${coldLines(report).slice(0, 3).join(" | ")}`);
          throw Object.assign(error, { report });
        }
        if (issues.length) throw new Error(`${issues.length} console or network issue(s), first: ${issues[0]}`);
      };
      let coldDetails = [];
      const coldFailure = await coldAttempt().then(
        () => null,
        (error) => ((coldDetails = error.report ? coldDetail(error.report) : []), failureOf(error)),
      );
      results.push(!coldFailure);
      const lazyViews = lazy ? ` [${lazy} lazy view(s) not in view, not compared]` : "";
      line(coldFailure, size, `cold render: ${name} (${path})${lazyViews}`);
      if (DETAIL && coldDetails.length) console.log(coldDetails.join("\n"));
    }
    // A hydrated page is live: a nav link moves to another page in the same document, which then renders.
    const navigate = async () => {
      page.issues();
      // loads the page and waits until it has hydrated (the page check reports what that changed)
      await checkHydration(page, "/packages/quark", { loading: LOADING });
      await page.do(() => {
        window.sameDocument = true;
        document.querySelector('spa-a[route-href="/packages/neutron"]').click();
      });
      const shown = () =>
        page.run(() => ({
          sameDocument: !!window.sameDocument,
          path: location.pathname,
          heading: document.querySelector("spa-route[is-active] h1")?.textContent.trim(),
        }));
      const arrived = ({ sameDocument, path, heading }) =>
        sameDocument && path === "/packages/neutron" && heading === "neutron";
      if (!(await until(async () => arrived(await shown()), 10_000))) throw new Error(JSON.stringify(await shown()));
      const issues = page.issues();
      if (issues.length) throw new Error(`${issues.length} console or network issue(s), first: ${issues[0]}`);
    };
    const failure = await navigate().then(() => null, failureOf);
    results.push(!failure);
    line(failure, size, "client navigation from a hydrated page");
    await page.close();
  }
  server.close();
  coldServer.close();
  await runner.close();
  console.log(`browser: ${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
}
