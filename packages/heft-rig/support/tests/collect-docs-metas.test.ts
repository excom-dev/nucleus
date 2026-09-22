import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  collectDocsMetas,
  prepareSiteDocs,
  topoPackageRoots,
} from "../../scripts/collect-docs-metas.mjs";
import {
  linkNodeModule,
  makeTempDir,
  packageJson,
  removeDir,
  writeFiles,
} from "./docs-pipeline-fixtures";

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const meta = (shortName: string | undefined, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    ...(shortName ? { shortName } : {}),
    package: { version: "0.0.1", excom: { packageType: "kit-element" } },
    elementApis: [],
    ...extra,
  });

describe("collectDocsMetas", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = makeTempDir("heft-rig-collect-");
  });
  afterAll(() => removeDir(tmp));
  afterEach(() => vi.restoreAllMocks());

  it("writes an empty index when there are no workspace packages", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const root = path.join(tmp, "empty-site");
    writeFiles(root, { "public/package-metas/stale.json": "{}" });
    const outDir = await collectDocsMetas(root);
    expect(outDir).toBe(path.join(root, "public/package-metas"));
    expect(readdirSync(outDir).sort()).toEqual(["index.json", "search-docs.json"]);
    expect(readJson(path.join(outDir, "index.json"))).toEqual({ packages: [], docs: [] });
    expect(readJson(path.join(outDir, "search-docs.json"))).toEqual({ version: 1, docs: [] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No @excom packages"));
  });

  it("aggregates package metas, the local site meta and the search corpus", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const root = path.join(tmp, "site");
    writeFiles(root, {
      "node_modules/@excom/zeta/support/package-meta.json": meta("zeta"),
      "node_modules/@excom/alpha/support/package-meta.json": meta("alpha", {
        readme: "<h1>Alpha</h1><p>Alpha intro.</p>",
      }),
      "node_modules/@excom/no-name/support/package-meta.json": meta(undefined),
      "node_modules/@excom/dup/support/package-meta.json": meta("alpha"),
      "node_modules/@excom/no-meta/package.json": "{}",
      "node_modules/@excom/file.txt": "not a dir",
      "support/package-meta.json": JSON.stringify({
        shortName: "site",
        package: { version: "9", excom: { packageType: "site" } },
        docs: { quick_start: "<h1>Quick Start</h1><p>Go.</p>", zz_no_title: "<p>Body</p>" },
      }),
    });
    writeFiles(tmp, { "linked/support/package-meta.json": meta("linked") });
    linkNodeModule(root, "@excom/linked", path.join(tmp, "linked"));

    const outDir = await collectDocsMetas(root);
    expect(readdirSync(outDir).sort()).toEqual([
      "alpha.json",
      "index.json",
      "linked.json",
      "no-name.json",
      "search-docs.json",
      "site.json",
      "zeta.json",
    ]);
    expect(readJson(path.join(outDir, "index.json"))).toEqual({
      packages: [
        { shortName: "alpha", packageType: "kit-element", version: "0.0.1" },
        { shortName: "linked", packageType: "kit-element", version: "0.0.1" },
        { shortName: "no-name", packageType: "kit-element", version: "0.0.1" },
        { shortName: "zeta", packageType: "kit-element", version: "0.0.1" },
      ],
      docs: [
        { name: "quick_start", title: "Quick Start" },
        { name: "zz_no_title", title: "Zz No Title" },
      ],
    });
    const search = readJson(path.join(outDir, "search-docs.json"));
    expect(search.version).toBe(1);
    // A meta without `shortName` keeps its fallback name only for the
    // catalog / file name; the search corpus reads `meta.shortName` as-is.
    expect(search.docs.map((d: any) => `${d.kind}:${d.package}`)).toEqual([
      "package:undefined",
      "package:alpha",
      "package:linked",
      "doc:quick_start",
      "doc:zz_no_title",
      "package:zeta",
    ]);
    expect(search.docs[1].text).toBe("Alpha intro.");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Wrote 4 package metas + 2 site docs"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("search-docs.json ("));
  });

  it("copies a site meta without docs and no-name metas without crashing on sort", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const root = path.join(tmp, "site2");
    writeFiles(root, {
      "node_modules/@excom/only/support/package-meta.json": meta(undefined),
      "support/package-meta.json": JSON.stringify({ package: { excom: { packageType: "site" } } }),
    });
    const outDir = await collectDocsMetas(root);
    expect(readJson(path.join(outDir, "index.json"))).toEqual({
      packages: [{ shortName: "only", packageType: "kit-element", version: "0.0.1" }],
      docs: [],
    });
  });

  it("prepareSiteDocs generates missing metas (bases first) then collects", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const root = path.join(tmp, "gen-site");
    const base = path.join(tmp, "gen-base");
    const child = path.join(tmp, "gen-child");
    writeFiles(base, {
      "package.json": packageJson("@excom/gen-base", {
        excom: { packageType: "library" },
      }),
      "support/docs/README.md": "# Gen Base\n\nBase intro.",
    });
    writeFiles(child, {
      "package.json": packageJson("@excom/gen-child", {
        dependencies: { "@excom/gen-base": "workspace:^" },
        excom: { packageType: "library" },
      }),
      "support/docs/README.md": "# Gen Child\n\nChild intro.",
    });
    writeFiles(root, {
      "package.json": packageJson("@excom/docs-site", {
        excom: { documented: false, packageType: "site" },
      }),
      "support/docs/INTRO.md": "# Intro\n\nHi.",
    });
    linkNodeModule(root, "@excom/gen-child", child);
    linkNodeModule(root, "@excom/gen-base", base);

    const outDir = await prepareSiteDocs(root);
    expect(existsSync(path.join(base, "support/package-meta.json"))).toBe(true);
    expect(existsSync(path.join(child, "support/package-meta.json"))).toBe(true);
    expect(existsSync(path.join(root, "support/package-meta.json"))).toBe(true);
    expect(readdirSync(outDir).sort()).toEqual([
      "docs-site.json",
      "gen-base.json",
      "gen-child.json",
      "index.json",
      "search-docs.json",
    ]);
    expect(readJson(path.join(outDir, "index.json")).docs).toEqual([
      { name: "intro", title: "Intro" },
    ]);
  });

  it("carries a package's docSections into the index catalog", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const root = path.join(tmp, "sections-site");
    const docSections = [
      { id: "define", title: "Defining", docs: [{ name: "props", title: "Props" }] },
    ];
    writeFiles(root, {
      "node_modules/@excom/paged/support/package-meta.json": meta("paged", {
        docs: { readme: "<h1>paged</h1>", props: "<h1>Props</h1>" },
        docSections,
      }),
      "node_modules/@excom/flat/support/package-meta.json": meta("flat", { docSections: [] }),
    });
    const outDir = await collectDocsMetas(root);
    expect(readJson(path.join(outDir, "index.json")).packages).toEqual([
      { shortName: "flat", packageType: "kit-element", version: "0.0.1" },
      { shortName: "paged", packageType: "kit-element", version: "0.0.1", docSections },
    ]);
  });

  it("keeps the site package out of `packages` while still writing its meta", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const root = path.join(tmp, "site-hidden");
    const docSections = [
      {
        id: "getting-started",
        title: "Getting Started",
        docs: [{ name: "introduction", title: "Introduction" }],
      },
    ];
    writeFiles(root, {
      "node_modules/@excom/quark/support/package-meta.json": meta("quark"),
      "support/package-meta.json": JSON.stringify({
        shortName: "docs-site",
        package: { version: "1", excom: { packageType: "site" } },
        docs: { introduction: "<h1>Introduction</h1><p>Hi.</p>" },
        docSections,
      }),
    });
    const outDir = await collectDocsMetas(root);

    // the guides read `docs-site.json`, so the meta itself is still emitted
    expect(existsSync(path.join(outDir, "docs-site.json"))).toBe(true);
    expect(readJson(path.join(outDir, "docs-site.json")).docSections).toEqual(docSections);

    const index = readJson(path.join(outDir, "index.json"));
    expect(index.packages.map((p: any) => p.shortName)).toEqual(["quark"]);
    expect(index.docs).toEqual([{ name: "introduction", title: "Introduction" }]);

    // ... and the corpus routes its docs as guides, not as package pages
    const search = readJson(path.join(outDir, "search-docs.json"));
    expect(search.docs.some((d: any) => d.package === "docs-site")).toBe(false);
    expect(search.docs.filter((d: any) => d.kind === "doc")).toEqual([
      { kind: "doc", package: "introduction", title: "Introduction", text: "Introduction Hi." },
    ]);
  });

  it("topoPackageRoots visits dependencies before dependents and ignores cycles", () => {
    const a = { root: "/a", name: "@excom/a", deps: ["@excom/b"] };
    const b = { root: "/b", name: "@excom/b", deps: ["@excom/c"] };
    const c = { root: "/c", name: "@excom/c", deps: ["@excom/a"] };
    const lone = { root: "/z", name: "@excom/z", deps: ["@excom/missing"] };
    expect(topoPackageRoots([a, b, c, lone])).toEqual(["/c", "/b", "/a", "/z"]);
  });
});
