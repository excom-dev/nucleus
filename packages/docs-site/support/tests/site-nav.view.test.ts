import "@excom/include-content";
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
import {
  displayName,
  getPackagesByType,
  type PackageIndexEntry,
} from "../../shell";

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

// happy-dom matches nothing for `:not(ul ul)`; a tree's root is the `ul`
// straight under its `include-content`
const sheetSrc = [
  ...(shell.match(/^\s*@use .+;$/gm) ?? []),
  shellRule('provider-fetch[api-url*="package-metas/index.json"][is-success]'),
  shellRule("[data-site-nav]"),
]
  .join("\n")
  .replaceAll("ul:not(ul ul)", "include-content > ul");

/** The desktop aside and the mobile sheet both stamp the one nav template. */
const stampers = page.querySelectorAll(
  'include-content[template-ref="#template-site-nav"]'
).length;

type NavEntry = PackageIndexEntry & { navGroup?: string };

const entry = (
  shortName: string,
  packageType: string,
  navGroup?: string
): NavEntry => ({
  shortName,
  packageType,
  version: "1.0.0",
  ...(navGroup ? { navGroup } : {}),
});

const index = {
  packages: [
    entry("content-tabs", "kit-element"),
    entry("fetchable-element", "element-base"),
    entry("neutron", "library"),
    entry("nucleus-dom", "library", "libraries"),
    entry("nucleus-kit", "library"),
    entry("nucleus-quark-highlighter", "tool"),
    entry("nucleus-test", "library", "libraries"),
    entry("quark", "library"),
    entry("quark-formatter", "tool", "libraries"),
    entry("valence", "library"),
  ],
  docs: [],
};

const GROUPED = ["nucleus-dom", "nucleus-test", "quark-formatter"];

const originalLoader = Quark.moduleLoader;

const mountNav = async () => {
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
    ${page.querySelector("#template-site-nav")!.outerHTML}
    ${page.querySelector("#template-tree")!.outerHTML}
    ${"<div data-stamp></div>".repeat(stampers)}
  </provider-fetch>`;
  const sheet = host.querySelector<HTMLQuarkSheetElement>("quark-sheet")!;
  sheet.textContent = sheetSrc;
  const provider = host.querySelector("provider-fetch")!;
  document.body.append(host);
  // happy-dom connects an `include-content` nested in another one's output
  // before it is attached, so the stamping is done here
  const nav = host.querySelector<HTMLTemplateElement>("#template-site-nav")!;
  host.querySelectorAll("[data-stamp]").forEach((el) => {
    el.append(document.importNode(nav.content, true));
  });
  await waitForEvent(provider, "provider-fetch-success");
  for (let i = 0; i < 6; i++) await flush();
  return [...host.querySelectorAll<HTMLElement>("[data-site-nav]")];
};

const linksOf = (group: Element | null) =>
  [...(group?.querySelectorAll("spa-a") ?? [])].map((a) => ({
    text: a.textContent,
    href: a.getAttribute("route-href"),
  }));

const hrefs = (names: string[]) => names.map((n) => `/nucleus/packages/${n}`);

describe("site nav packages", () => {
  beforeEach(() => {
    Quark.moduleLoader = async (url: string) => {
      if (url.includes("shell")) return { displayName, getPackagesByType };
      throw new Error(`unexpected @use module: ${url}`);
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Quark.moduleLoader = originalLoader;
    vi.restoreAllMocks();
  });

  it("is one template, stamped by the desktop aside and the mobile sheet", async () => {
    expect(stampers).toBe(2);
    expect(await mountNav()).toHaveLength(2);
  });

  it("lists the libraries without a nav group at the top level", async () => {
    for (const nav of await mountNav()) {
      expect(
        linksOf(nav.querySelector("[bind-libraries]")).map((l) => l.text)
      ).toEqual(["Neutron", "Nucleus Kit", "Quark", "Valence.css"]);
    }
  });

  it("puts every nav-group package in a collapsed Libraries group between Tools and Element Bases", async () => {
    for (const nav of await mountNav()) {
      const order = [...nav.querySelector(".package-links")!.children].map(
        (el) =>
          el.getAttributeNames().find((n) => n.startsWith("bind-")) ??
          el.tagName.toLowerCase()
      );
      expect(order).toEqual([
        "hgroup",
        "bind-libraries",
        "bind-elements",
        "bind-tools",
        "bind-library-group",
        "bind-element-bases",
      ]);

      const group = nav.querySelector("details[bind-library-group]")!;
      expect(group.querySelector(":scope > summary")?.textContent).toBe(
        "Libraries"
      );
      expect(group.hasAttribute("open")).toBe(false);
      expect(linksOf(group)).toEqual(
        GROUPED.map((name) => ({
          text: name,
          href: `/nucleus/packages/${name}`,
        }))
      );
    }
  });

  it("keeps the nav-group packages out of the top level and Tools", async () => {
    for (const nav of await mountNav()) {
      const top = linksOf(nav.querySelector("[bind-libraries]"));
      const tools = linksOf(nav.querySelector("[bind-tools]"));
      expect(tools.map((l) => l.href)).toEqual(
        hrefs(["nucleus-quark-highlighter"])
      );
      for (const href of hrefs(GROUPED)) {
        expect(top.map((l) => l.href)).not.toContain(href);
        expect(tools.map((l) => l.href)).not.toContain(href);
      }
    }
  });

  it("leaves Elements and Element Bases as they were", async () => {
    for (const nav of await mountNav()) {
      expect(linksOf(nav.querySelector("[bind-elements]"))).toEqual([
        { text: "content-tabs", href: "/nucleus/packages/content-tabs" },
      ]);
      expect(linksOf(nav.querySelector("[bind-element-bases]"))).toEqual([
        {
          text: "fetchable-element",
          href: "/nucleus/packages/fetchable-element",
        },
      ]);
    }
  });

  it("opens the group while one of its pages is active", async () => {
    const [nav] = await mountNav();
    const group = nav!.querySelector("details[bind-library-group]")!;
    expect(group.hasAttribute("open")).toBe(false);

    group
      .querySelector('spa-a[route-href="/nucleus/packages/nucleus-dom"]')!
      .setAttribute("is-active", "");
    for (let i = 0; i < 3; i++) await flush();

    expect(group.hasAttribute("open")).toBe(true);
  });
});
