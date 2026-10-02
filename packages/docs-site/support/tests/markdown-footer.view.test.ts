import "@excom/provider-fetch";
import "@excom/quark-sheet";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  readFileRelative,
  vi,
  waitForEvent,
} from "@excom/nucleus-test";
import { Quark } from "@excom/quark";
import { flush } from "@excom/quark/support/tests/view-helpers";
import {
  displayName,
  docTitle,
  getPackagesByType,
  SITE_BASE,
  SITE_HOME_DOC,
  siteDocHref,
} from "../../shell";

const shell = readFileRelative(import.meta.url, "../../index.html");
// `<link>`s are dropped: happy-dom would try to fetch them while parsing.
const page = new DOMParser().parseFromString(
  shell.replace(/<link[\s\S]*?>/g, ""),
  "text/html"
);
const manager = page.querySelector("main spa-manager")!;
// read before a test defines the elements: the parsed page's manager is live in its window
const footerHtml = manager.querySelector(":scope > footer")!.outerHTML;

/** A `selector { … }` rule of the shell sheet, braces balanced. */
const shellRule = (selector: string) => {
  const start = shell.indexOf(`${selector} {`);
  let depth = 0;
  for (let i = shell.indexOf("{", start); start >= 0 && i < shell.length; i++) {
    depth += shell[i] === "{" ? 1 : shell[i] === "}" ? -1 : 0;
    if (!depth) return shell.slice(start, i + 1);
  }
  throw new Error(`index.html has no ${selector} rule`);
};

// the index rule (nav, titles, markdown link) and the rule publishing `$route`
const sheetSrc = [
  ...(shell.match(/^\s*@use .+;$/gm) ?? []),
  shellRule('provider-fetch[api-url*="package-metas/index.json"][is-success]'),
  shellRule("spa-route"),
].join("\n");

const index = {
  packages: [
    // no flag: no markdown file of its own
    { shortName: "quark", packageType: "library", version: "1.0.0" },
    {
      shortName: "spa-route",
      packageType: "kit-element",
      version: "1.0.0",
      markdown: true,
    },
  ],
  docs: [
    { name: SITE_HOME_DOC, title: "Introduction" },
    { name: "quick_start", title: "Quick Start" },
  ],
};

const originalLoader = Quark.moduleLoader;

/** Markup under the index provider: the shell's manager and footer. */
const mount = async (markup = manager.outerHTML) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify(index), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  const host = document.createElement("div");
  host.innerHTML = `<quark-sheet></quark-sheet>
  <provider-fetch api-url="/package-metas/index.json">${markup}</provider-fetch>`;
  host.querySelector("quark-sheet")!.textContent = sheetSrc;
  document.body.append(host);
  await waitForEvent(
    host.querySelector("provider-fetch")!,
    "provider-fetch-success"
  );
  const [pageLink, indexLink] = [...host.querySelectorAll("footer > a")];
  return { host, pageLink: pageLink!, indexLink: indexLink! };
};

const settle = async () => {
  for (let i = 0; i < 4; i++) await flush();
};

/** What a navigation does to the manager: it states the URL of the active route. */
const goTo = async (host: Element, url: string) => {
  host.querySelector("spa-manager")!.setAttribute("active-url", url);
  await settle();
};

describe("the shell's markdown links", () => {
  it("end every page, in plain links: one for the page, one for the docs index", () => {
    const routes = [...manager.querySelectorAll(":scope > spa-route")];
    const footer = manager.querySelector(":scope > footer")!;
    expect(routes.length).toBeGreaterThan(1);
    // after the last route, and in no route: the same on every page
    expect(manager.lastElementChild).toBe(footer);
    expect(footer.closest("spa-route")).toBeNull();
    // files, not routes
    expect(footer.querySelector("spa-a")).toBeNull();
    const [pageLink, indexLink] = [...footer.querySelectorAll("a")];
    expect(footer.querySelectorAll("a")).toHaveLength(2);
    // the sheet paints the first one: markup alone says nothing of a page
    expect(pageLink!.hasAttribute("bind-page-markdown")).toBe(true);
    expect(pageLink!.getAttribute("href")).toBeNull();
    expect(pageLink!.textContent).toBe("");
    expect(indexLink!.getAttribute("href")).toBe("/llms.txt");
    expect(indexLink!.textContent).toBe("Docs index as markdown");
  });

  it("keep the two links of the head and the description's pointer", () => {
    expect(shell).toContain(
      '<link rel="alternate" type="text/markdown" href="/llms.txt"'
    );
    expect(shell).toContain(
      '<link rel="alternate" type="text/markdown" href="/llms-full.txt"'
    );
    expect(shell).toContain("start at /llms.txt.");
  });
});

describe("the page's markdown link", () => {
  beforeEach(() => {
    Quark.moduleLoader = async () => ({
      displayName,
      docTitle,
      getPackagesByType,
      SITE_BASE,
      SITE_HOME_DOC,
      siteDocHref,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Quark.moduleLoader = originalLoader;
    vi.restoreAllMocks();
  });

  it("points a guide at its file, and the docs home at the Introduction's", async () => {
    const { host, pageLink, indexLink } = await mount();
    await goTo(host, `${SITE_BASE}/docs/quick_start`);
    expect(pageLink.getAttribute("href")).toBe("/docs/quick_start.md");
    expect(pageLink.textContent).toBe("Markdown version of this page");
    await goTo(host, SITE_BASE);
    expect(pageLink.getAttribute("href")).toBe("/docs/introduction.md");
    // the index link is never touched
    expect(indexLink.getAttribute("href")).toBe("/llms.txt");
    expect(indexLink.textContent).toBe("Docs index as markdown");
  });

  it("ignores the query and the hash of the URL", async () => {
    const { host, pageLink } = await mount();
    await goTo(host, `${SITE_BASE}/docs/quick_start?tab=api#md-usage`);
    expect(pageLink.getAttribute("href")).toBe("/docs/quick_start.md");
    await goTo(host, `${SITE_BASE}?utm=docs#md-start-here`);
    expect(pageLink.getAttribute("href")).toBe("/docs/introduction.md");
  });

  it("points a package's page at its file when its index entry says it has one", async () => {
    const { host, pageLink } = await mount();
    await goTo(host, `${SITE_BASE}/packages/spa-route`);
    expect(pageLink.getAttribute("href")).toBe("/spa-route.md");
    expect(pageLink.textContent).toBe("Markdown version of this page");
    await goTo(host, `${SITE_BASE}/packages/spa-route?tab=api#md-usage`);
    expect(pageLink.getAttribute("href")).toBe("/spa-route.md");
  });

  it("has none for a package whose index entry has no flag, or no entry", async () => {
    const { host, pageLink } = await mount();
    await goTo(host, `${SITE_BASE}/packages/spa-route`);
    for (const name of ["quark", "no-such-package"]) {
      await goTo(host, `${SITE_BASE}/packages/${name}`);
      expect(pageLink.hasAttribute("href"), name).toBe(false);
      expect(pageLink.textContent, name).toBe("");
      await goTo(host, `${SITE_BASE}/packages/spa-route`);
    }
  });

  it("has none for a sub-page of a package, or a flagged package's name anywhere else", async () => {
    const { host, pageLink } = await mount();
    for (const url of [
      `${SITE_BASE}/packages/spa-route/quick_start`,
      `${SITE_BASE}/packages/spa-route/props`,
      `${SITE_BASE}/packages/quark/spa-route`,
      `${SITE_BASE}/docs/spa-route`,
      `${SITE_BASE}/examples/spa-route`,
      "/spa-route",
    ]) {
      await goTo(host, `${SITE_BASE}/packages/spa-route`);
      await goTo(host, url);
      expect(pageLink.hasAttribute("href"), url).toBe(false);
      expect(pageLink.textContent, url).toBe("");
    }
  });

  it("follows a client-side navigation between guides, packages and pages without a file", async () => {
    const { host, pageLink } = await mount();
    await goTo(host, `${SITE_BASE}/docs/quick_start`);
    expect(pageLink.getAttribute("href")).toBe("/docs/quick_start.md");
    await goTo(host, `${SITE_BASE}/packages/spa-route`);
    expect(pageLink.getAttribute("href")).toBe("/spa-route.md");
    await goTo(host, `${SITE_BASE}/packages/quark`);
    expect(pageLink.hasAttribute("href")).toBe(false);
    expect(pageLink.textContent).toBe("");
    await goTo(host, SITE_BASE);
    expect(pageLink.getAttribute("href")).toBe("/docs/introduction.md");
    await goTo(host, `${SITE_BASE}/packages/quark/quick_start`);
    expect(pageLink.hasAttribute("href")).toBe(false);
    expect(pageLink.textContent).toBe("");
  });

  it("has none for what is no guide's page: examples, the company page, an unknown guide, the 404", async () => {
    const { host, pageLink } = await mount();
    for (const url of [
      "/",
      `${SITE_BASE}/examples/todos`,
      `${SITE_BASE}/docs/no_such_guide`,
      // the home guide has no /docs URL: that one is the 404
      `${SITE_BASE}/docs/${SITE_HOME_DOC}`,
      `${SITE_BASE}/packages/quark/props`,
      "/404",
    ]) {
      await goTo(host, `${SITE_BASE}/docs/quick_start`);
      await goTo(host, url);
      expect(pageLink.hasAttribute("href"), url).toBe(false);
      expect(pageLink.textContent, url).toBe("");
    }
  });

  // last: it defines the router's elements for the rest of the file
  it("reads the URL a real spa-manager states, and follows its navigation", async () => {
    await import("@excom/spa-route");
    const { resetRouter } = await import("@excom/spa-route/testing");
    const { kitRouter } = await import("@excom/kit-router");
    resetRouter(`${SITE_BASE}/docs/quick_start`);
    const { host, pageLink } = await mount(
      `<spa-manager>${footerHtml}</spa-manager>`
    );
    await settle();
    expect(host.querySelector("spa-manager")!.getAttribute("active-url")).toBe(
      `${SITE_BASE}/docs/quick_start`
    );
    expect(pageLink.getAttribute("href")).toBe("/docs/quick_start.md");
    kitRouter.pushState({ url: `${SITE_BASE}/packages/spa-route#md-usage` });
    await settle();
    expect(pageLink.getAttribute("href")).toBe("/spa-route.md");
    kitRouter.pushState({ url: `${SITE_BASE}/packages/quark` });
    await settle();
    expect(pageLink.hasAttribute("href")).toBe(false);
    kitRouter.pushState({ url: SITE_BASE });
    await settle();
    expect(pageLink.getAttribute("href")).toBe("/docs/introduction.md");
  });
});
