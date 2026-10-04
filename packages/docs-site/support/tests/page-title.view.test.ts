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
import {
  flush,
} from "@excom/quark/support/tests/view-helpers";
import { displayName, docTitle, getPackagesByType } from "../../shell";

const shell = readFileRelative(import.meta.url, "../../index.html");
// `<link>`s are dropped: happy-dom would try to fetch them while parsing.
const page = new DOMParser().parseFromString(
  shell.replace(/<link[\s\S]*?>/g, ""),
  "text/html"
);

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

// the index rule (nav and titles) and the rule publishing `$route`
const sheetSrc = [
  ...(shell.match(/^\s*@use .+;$/gm) ?? []),
  shellRule('provider-fetch[api-url*="package-metas/index.json"][is-success]'),
  shellRule("spa-route"),
].join("\n");

const index = {
  packages: [
    { shortName: "quark", packageType: "library", version: "1.0.0" },
    {
      shortName: "neutron",
      packageType: "library",
      version: "1.0.0",
      docSections: [
        {
          id: "a",
          title: "Defining",
          docs: [{ name: "props", title: "Props" }],
        },
      ],
    },
  ],
  docs: [{ name: "quick_start", title: "Quick Start" }],
};

const originalLoader = Quark.moduleLoader;

/** The shell's routes under the index provider; `active` gets `provision`. */
const mountRoutes = async (active: { href: string; params: object }) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify(index), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  const host = document.createElement("div");
  host.innerHTML = `<quark-sheet></quark-sheet>
  <provider-fetch api-url="/package-metas/index.json">
    ${page.querySelector("spa-manager")!.innerHTML}
  </provider-fetch>`;
  const route = host.querySelector<HTMLElement & { provision?: object }>(
    `spa-route[route-href="${active.href}"]`
  )!;
  route.provision = { params: active.params };
  route.setAttribute("is-active", "");
  host.querySelector("quark-sheet")!.textContent = sheetSrc;
  document.body.append(host);
  await waitForEvent(
    host.querySelector("provider-fetch")!,
    "provider-fetch-success"
  );
  for (let i = 0; i < 4; i++) await flush();
  return { host, route };
};

const titles = (host: Element) =>
  [...host.querySelectorAll("spa-route[document-title]")].map((route) =>
    route.getAttribute("document-title")
  );

describe("page titles", () => {
  beforeEach(() => {
    Quark.moduleLoader = async () => ({
      displayName,
      docTitle,
      getPackagesByType,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Quark.moduleLoader = originalLoader;
    vi.restoreAllMocks();
  });

  it("titles a site guide by its heading, an unknown one by its name", async () => {
    const href = "/docs/(?!introduction$):name";
    const { route } = await mountRoutes({
      href,
      params: { name: "quick_start" },
    });
    expect(route.getAttribute("document-title")).toBe(
      "Quick Start · Nucleus · docs"
    );
    route.provision = { params: { name: "glossary" } };
    for (let i = 0; i < 3; i++) await flush();
    expect(route.getAttribute("document-title")).toBe(
      "glossary · Nucleus · docs"
    );
  });

  it("titles a package README by the package's display name", async () => {
    const href = "/packages/:packageName";
    const { route } = await mountRoutes({
      href,
      params: { packageName: "quark" },
    });
    expect(route.getAttribute("document-title")).toBe("Quark · Nucleus · docs");
  });

  it("titles a package doc page by the page, then the package", async () => {
    const href = "/packages/:packageName/:docName";
    const { route } = await mountRoutes({
      href,
      params: { packageName: "neutron", docName: "props" },
    });
    expect(route.getAttribute("document-title")).toBe(
      "Props · Neutron · Nucleus · docs"
    );
  });

  it("titles only the active route, and leaves the docs home to the page's own title", async () => {
    const { host } = await mountRoutes({ href: "/", params: {} });
    // the markup's own: the examples, the 404
    expect(titles(host)).toEqual(
      [...page.querySelectorAll("spa-route[document-title]")].map((route) =>
        route.getAttribute("document-title")
      )
    );
  });
});
