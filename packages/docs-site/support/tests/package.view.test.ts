import "@excom/event-handler";
import "@excom/include-content";
import "@excom/provider-fetch";
import "@excom/quark-sheet";
import "@excom/spa-route";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { Quark } from "@excom/quark";
import {
  bypassSelectorCache,
  flush,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";
import {
  docMetaUrl,
  docNeighbors,
  docTitle,
  getDocHtml,
  type PackageMeta,
} from "../../shell";

const html = readViewFile(
  import.meta.url,
  "../../public/views/package/package.html",
);
const quarkSrc = readViewFile(
  import.meta.url,
  "../../public/views/package/package.quark",
);

/** The pure doc helpers of `@use "/shell"`; the real module boots Shiki. */
const shellStub = {
  docMetaUrl,
  getDocHtml,
  docNeighbors,
  docTitle,
  upgradeTemplateCode: () => {},
};

const neutronMeta: PackageMeta = {
  shortName: "neutron",
  package: {
    name: "@excom/neutron",
    version: "1.0.0",
    excom: { packageType: "library" },
  },
  demos: {},
  readme:
    '<h1 id="md-neutron">neutron</h1><p>Overview.</p><h2 id="md-usage">Usage</h2>',
  docs: {
    readme:
      '<h1 id="md-neutron">neutron</h1><p>Overview.</p><h2 id="md-usage">Usage</h2>',
    props:
      '<h1 id="md-props">Props</h1><h2 id="md-shorthand">Shorthand</h2><h3 id="md-keys">Keys</h3>',
    effects: '<h1 id="md-effects">Effects</h1><p>No sub-headings.</p>',
  },
  docSections: [
    {
      id: "define",
      title: "Defining elements",
      docs: [{ name: "props", title: "Props" }],
    },
    {
      id: "behavior",
      title: "Behavior",
      docs: [{ name: "effects", title: "Effects" }],
    },
  ],
  elementApis: [],
  exportedFiles: {},
};

const siteMeta = {
  shortName: "docs-site",
  package: {
    name: "@excom/docs-site",
    version: "1",
    excom: { packageType: "site" },
  },
  docs: {
    introduction: '<h1 id="md-introduction">Introduction</h1>',
    core_concepts: '<h1 id="md-core-concepts">Core Concepts</h1>',
  },
  docSections: [
    {
      id: "getting-started",
      title: "Getting Started",
      docs: [
        { name: "introduction", title: "Introduction" },
        { name: "core_concepts", title: "Core Concepts" },
      ],
    },
  ],
  demos: {},
  elementApis: [],
  exportedFiles: {},
};

const requested: string[] = [];

const mockFetch = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost").pathname;
    requested.push(url);
    const body = url.endsWith("/neutron.json")
      ? neutronMeta
      : url.endsWith("/docs-site.json")
        ? siteMeta
        : null;
    return new Response(JSON.stringify(body), {
      status: body ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  });

const stripAssets = (s: string) =>
  s.replace(/<link[\s\S]*?>/g, "").replace(/\s+src-url="[^"]*"/g, "");

/**
 * Mount the view under a stand-in for the shell: a `spa-route` whose
 * `provision` carries the route params and an outer sheet publishing
 * `$route` / `$route-doc-name` from it, exactly as `index.html` does.
 * `routeDocName` stands in for the home route's `data-doc-name`.
 */
const mountPage = async (
  params: Record<string, string>,
  {
    expectFetch = true,
    routeDocName,
  }: { expectFetch?: boolean; routeDocName?: string } = {},
) => {
  const host = document.createElement("div");
  host.innerHTML = `<quark-sheet>spa-route { $route: prop("provision"); $route-doc-name: attr("data-doc-name"); }</quark-sheet><spa-route></spa-route>`;
  const route = host.querySelector<HTMLElement & { provision: unknown }>(
    "spa-route",
  )!;
  if (routeDocName) route.setAttribute("data-doc-name", routeDocName);
  route.provision = { params };
  route.innerHTML = stripAssets(html);
  const sheet = route.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
  sheet.textContent = quarkSrc;
  document.body.append(host);
  const provider = route.querySelector<HTMLElement>("provider-fetch.doc-page")!;
  if (!sheet.quarkInstance) await waitForEvent(sheet, "quark-sheet-success");
  if (expectFetch && !provider.hasAttribute("is-success")) {
    await waitForEvent(provider, "provider-fetch-success");
  }
  await flush();
  await flush();
  return { page: provider };
};

const originalLoader = Quark.moduleLoader;

describe("package view", () => {
  beforeEach(() => {
    bypassSelectorCache();
    requested.length = 0;
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

  it("renders a package doc page with breadcrumb, section list and neighbors", async () => {
    const { page } = await mountPage({
      packageName: "neutron",
      docName: "props",
    });

    expect(requested).toEqual(["/package-metas/neutron.json"]);
    expect(page.hasAttribute("data-is-package-doc")).toBe(true);
    expect(page.getAttribute("data-package-type")).toBe("library");
    expect(page.querySelector(".md-content h1")?.textContent).toBe("Props");

    const crumb = page.querySelector("[bind-package-link]")!;
    expect(crumb.getAttribute("route-href")).toBe("/nucleus/packages/neutron");
    expect(crumb.textContent).toBe("neutron");

    expect(page.hasAttribute("data-has-prev")).toBe(true);
    expect(page.hasAttribute("data-has-next")).toBe(true);
    expect(
      page.querySelector("[bind-prev-page]")?.getAttribute("route-href"),
    ).toBe("/nucleus/packages/neutron");
    expect(page.querySelector("[bind-prev-page]")?.textContent).toBe("neutron");
    expect(
      page.querySelector("[bind-next-page]")?.getAttribute("route-href"),
    ).toBe("/nucleus/packages/neutron/effects");
    expect(page.querySelector("[bind-next-page]")?.textContent).toBe("Effects");
  });

  it("renders the README as the overview: no breadcrumb, no previous page", async () => {
    const { page } = await mountPage({ packageName: "neutron" });

    expect(requested).toEqual(["/package-metas/neutron.json"]);
    expect(page.hasAttribute("data-is-package-doc")).toBe(false);
    expect(page.querySelector(".md-content h1")?.textContent).toBe("neutron");
    expect(page.hasAttribute("data-has-prev")).toBe(false);
    expect(page.hasAttribute("data-has-next")).toBe(true);
    expect(
      page.querySelector("[bind-next-page]")?.getAttribute("route-href"),
    ).toBe("/nucleus/packages/neutron/props");
  });

  it("hides the next link on the last page", async () => {
    const { page } = await mountPage({
      packageName: "neutron",
      docName: "effects",
    });

    expect(page.hasAttribute("data-has-next")).toBe(false);
    expect(
      page.querySelector("[bind-prev-page]")?.getAttribute("route-href"),
    ).toBe("/nucleus/packages/neutron/props");
  });

  it("renders a site guide from the docs-site meta with no package chrome", async () => {
    const { page } = await mountPage({ name: "introduction" });

    expect(requested).toEqual(["/package-metas/docs-site.json"]);
    expect(page.hasAttribute("data-is-package-doc")).toBe(false);
    expect(page.querySelector(".md-content h1")?.textContent).toBe(
      "Introduction",
    );
    // the first guide starts the walk, so there is no previous page
    expect(page.hasAttribute("data-has-prev")).toBe(false);
    expect(page.hasAttribute("data-has-next")).toBe(true);
    expect(
      page.querySelector("[bind-next-page]")?.getAttribute("route-href"),
    ).toBe("/nucleus/docs/core_concepts");
    expect(page.querySelector("[bind-next-page]")?.textContent).toBe(
      "Core Concepts",
    );
  });

  it("renders the home route's guide from its data-doc-name, with no params", async () => {
    const { page } = await mountPage({}, { routeDocName: "introduction" });

    expect(requested).toEqual(["/package-metas/docs-site.json"]);
    expect(page.hasAttribute("data-is-package-doc")).toBe(false);
    expect(page.querySelector(".md-content h1")?.textContent).toBe(
      "Introduction",
    );
  });

  it("keeps guide neighbors inside /nucleus/docs, and links the home guide as /nucleus", async () => {
    const { page } = await mountPage({ name: "core_concepts" });

    expect(
      page.querySelector("[bind-prev-page]")?.getAttribute("route-href"),
    ).toBe("/nucleus");
    expect(page.hasAttribute("data-has-next")).toBe(false);
  });

  it("renders nothing for a hand-typed /nucleus/packages/docs-site route", async () => {
    const { page } = await mountPage(
      { packageName: "docs-site" },
      { expectFetch: false },
    );

    expect(page.hasAttribute("api-url")).toBe(false);
    expect(requested).toEqual([]);
    expect(page.hasAttribute("is-success")).toBe(false);
    expect(page.querySelector(".md-content")?.innerHTML).toBe("");
  });

  it("renders nothing for a hand-typed /nucleus/packages/docs-site/<doc> route", async () => {
    const { page } = await mountPage(
      { packageName: "docs-site", docName: "core_concepts" },
      { expectFetch: false },
    );

    expect(page.hasAttribute("api-url")).toBe(false);
    expect(requested).toEqual([]);
    expect(page.hasAttribute("is-success")).toBe(false);
    expect(page.querySelector(".md-content")?.innerHTML).toBe("");
  });
});
