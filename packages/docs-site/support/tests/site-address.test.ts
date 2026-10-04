// Where the site's files name its address: the docs own the root of their origin.
import { describe, expect, it, readFileRelative } from "@excom/nucleus-test";
import { SITE_ORIGIN } from "@excom/heft-rig/scripts/build-npm-readmes.mjs";
import * as rig from "@excom/heft-rig/scripts/site-base.mjs";
import { headersOf } from "@excom/vite-plugin-nucleus/host";
import { SITE_BASE, SITE_HOME } from "../../shell";

const read = (file: string) =>
  readFileRelative(import.meta.url, `../../${file}`);

// `<link>`s are dropped: happy-dom would try to fetch them while parsing.
const parse = (file: string) =>
  new DOMParser().parseFromString(
    read(file).replace(/<link[\s\S]*?>/g, ""),
    "text/html"
  );

const REVALIDATE = "public, max-age=0, must-revalidate";
const COMPANY = "https://excom.dev";

describe("the site's address", () => {
  it("is the root of nucleus.excom.dev", () => {
    expect(SITE_ORIGIN).toBe("https://nucleus.excom.dev");
    expect(SITE_BASE).toBe("");
    expect(SITE_HOME).toBe("/");
    // the rig emits the links, the shell routes them: one base, defined twice
    expect([rig.SITE_BASE, rig.SITE_HOME]).toEqual([SITE_BASE, SITE_HOME]);
  });

  it("revalidates every prerendered page, each path ruled once", () => {
    const text = read("public/_headers");
    const cache = new Map(
      headersOf(text).map(({ path, set }) => [path, set["cache-control"]])
    );
    for (const path of ["/", "/docs/*", "/packages/*", "/examples/*"]) {
      expect(cache.get(path), path).toBe(REVALIDATE);
    }
    // a later block for a path replaces the earlier one: none may repeat
    const paths = text.split("\n").filter((line) => line.startsWith("/"));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((path) => path.startsWith("/nucleus"))).toEqual([]);
  });

  it("installs and starts at the docs home", () => {
    expect(JSON.parse(read("public/manifest.json"))).toMatchObject({
      id: SITE_HOME,
      start_url: SITE_HOME,
      scope: "/",
    });
  });

  it("deploys to the origin the rig links, and names its sitemap there", () => {
    const [, pattern] = /"pattern":\s*"([^"]+)"/.exec(read("wrangler.jsonc"))!;
    expect(`https://${pattern}`).toBe(SITE_ORIGIN);
    expect(read("public/robots.txt")).toContain(
      `Sitemap: ${SITE_ORIGIN}/sitemap.xml`
    );
  });

  it("describes itself at its own origin, published by the company at its own", () => {
    const shell = parse("index.html");
    const [organization, website, source] = JSON.parse(
      shell.querySelector('script[type="application/ld+json"]')!.textContent!
    )["@graph"];
    expect(organization.url).toBe(COMPANY);
    expect(website.url).toBe(`${SITE_ORIGIN}/`);
    expect(source.url).toBe(`${SITE_ORIGIN}/`);
    for (const property of ["og:image", "twitter:image"]) {
      expect(
        shell
          .querySelector(`meta[property="${property}"], meta[name="${property}"]`)!
          .getAttribute("content")
      ).toBe(`${SITE_ORIGIN}/og-image.png`);
    }
  });

  /* The company page left for its own origin: a route link to it would now
     land on the docs home. */
  it("links home by route, and the company's site as another origin", () => {
    const header = parse("public/views/site-header/site-header.html");
    const nav = parse("index.html").querySelector<HTMLTemplateElement>(
      "#template-site-nav"
    )!.content;
    for (const [name, root, labels] of [
      ["header", header, ["Home"]],
      ["nav", nav, ["Introduction", "Nucleus Stack home"]],
    ] as const) {
      const home = [
        ...root.querySelectorAll(`spa-a[route-href="${SITE_HOME}"]`),
      ].map(
        (link) => link.getAttribute("aria-label") ?? link.textContent!.trim()
      );
      expect(home, name).toEqual(labels);
      expect(
        [...root.querySelectorAll(`a[href="${COMPANY}"]`)].map(
          (link) =>
            link.getAttribute("aria-label") ??
            link.querySelector("img")!.getAttribute("alt")
        ),
        name
      ).toEqual(["excom", "Contact"]);
    }
  });

  it("orders the nav's libraries by routes under the base", () => {
    const ordered = [
      ...read("shell.css").matchAll(/spa-a\[route-href="([^"]+)"\]/g),
    ].map(([, href]) => href);
    expect(ordered).toEqual(
      ["quark", "valence", "neutron"].map(
        (name) => `${SITE_BASE}/packages/${name}`
      )
    );
  });
});
