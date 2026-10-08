import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { siteConfig } from "../../index.mjs";
import { kitOf, kitPlugin, unpkgKitOf } from "../../src/kit.mjs";
import { buildExports } from "../../../heft-rig/scripts/build-exports.mjs";
import { makeTempDir, removeDir, writeFiles } from "../../../heft-rig/support/tests/docs-pipeline-fixtures";

/**
 * An installed Nucleus Kit bundling two packages: Quark (code) and Valence (a
 * stylesheet, and mixins that add no CSS). Every file carries a marker the build
 * output is searched for. Sites sit beside it and find it as Node would.
 */
const MODULES = {
  "node_modules/@excom/nucleus-kit/package.json": JSON.stringify({
    name: "@excom/nucleus-kit",
    version: "9.9.9",
    main: "index.js",
    dependencies: { "@excom/quark": "9.9.9", "@excom/valence": "9.9.9" },
  }),
  "node_modules/@excom/nucleus-kit/index.js": "document.body.dataset.kit = 'kit-index-marker';\n",
  "node_modules/@excom/nucleus-kit/nucleus-kit.progressive.js": "document.body.dataset.kit = 'kit-code-marker';\n",
  "node_modules/@excom/nucleus-kit/basic.css": ".kit-marker { color: blue; }\n",
  "node_modules/@excom/nucleus-kit/x.svg": "<svg/>",
  "node_modules/@excom/quark/package.json": JSON.stringify({ name: "@excom/quark", type: "module", main: "index.js" }),
  "node_modules/@excom/quark/index.js": "export const Quark = 'quark-code-marker';\n",
  "node_modules/@excom/valence/package.json": JSON.stringify({ name: "@excom/valence" }),
  "node_modules/@excom/valence/basic.css": ".valence-marker { color: green; }\n",
  "node_modules/@excom/valence/src/mixins.css": "/* definitions */\n@define-mixin quiet { color: gray; }\n@custom-selector :--quiet .quiet;\n",
};

const page = (head: string) => `<!doctype html><html><head>${head}</head><body><p>site</p></body></html>\n`;
const KIT_SCRIPT = '<script type="module">import "@excom/nucleus-kit/nucleus-kit.progressive";</script>';

let tmp: string;

beforeAll(() => {
  tmp = makeTempDir("vite-plugin-nucleus-kit-");
  writeFiles(tmp, MODULES);
});

afterAll(() => removeDir(tmp));

/** Writes a site beside the kit in `base` and builds it; resolves with every output file's text. */
const built = async (name: string, files: Record<string, string>, kit: "bundled" | "unpkg" = "unpkg", base = tmp) => {
  const root = path.join(base, name);
  writeFiles(root, { "package.json": JSON.stringify({ name, type: "module" }), ...files });
  await build({ ...(await siteConfig({ command: "build", root, kit })), root, configFile: false, logLevel: "silent" });
  const dist = path.join(root, "dist");
  return readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
};

const stopper = { error: (message: string) => { throw new Error(message); } };

/** The kit plugin of an unpkg build of the site at `root`. */
const pluginFor = async (root: string) => {
  const unpkg = await unpkgKitOf(root);
  return kitPlugin(() => unpkg);
};

describe("kitPlugin", () => {
  it("resolves a script's Nucleus Kit import to unpkg at the installed version, outside the bundle", async () => {
    const kit = await pluginFor(tmp);
    expect([kit.name, kit.enforce]).toEqual(["nucleus-kit", "pre"]);
    expect(kit.config()).toEqual({ build: { modulePreload: { polyfill: false } } });
    expect(kit.resolveId.call(stopper, "@excom/nucleus-kit/nucleus-kit.progressive", "/s/index.html")).toEqual({
      id: "https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/nucleus-kit.progressive.min.js",
      external: true,
    });
    for (const source of ["@excom/nucleus-kit", "@excom/quark", "./local.js"])
      expect(kit.resolveId.call(stopper, source, "/s/index.html")).toBeNull();
  });

  it("stops on a stylesheet's url() naming the kit or a package it bundles", async () => {
    const kit = await pluginFor(tmp);
    const id = path.join(tmp, "s/shell.css");
    await expect(kit.transform.call(stopper, 'p { background: url("@excom/valence/x.svg"); }', id)).rejects.toThrow(
      'kit "unpkg": s/shell.css names @excom/valence/x.svg in a url()'
    );
    expect(await kit.transform.call(stopper, "p { background: url(./x.svg); } /* url(@excom/quark/x) */", id)).toBeNull();
  });

  it("takes a stylesheet's Nucleus Kit @import out, whatever its quotes, and leaves the rest", async () => {
    const kit = await pluginFor(tmp);
    const id = path.join(tmp, "s/shell.css");
    for (const line of [
      '@import "@excom/nucleus-kit/basic.css";',
      "@import '@excom/nucleus-kit/basic.css';",
      "@import url(@excom/nucleus-kit/basic.css);",
      "@import url( '@excom/nucleus-kit/basic.css' );",
    ])
      expect(await kit.transform.call(stopper, `${line}\np{}`, id)).toEqual({ code: "\np{}", map: null });
    // linked once by the page that links the sheet
    writeFiles(tmp, { "s/index.html": page('<link rel="stylesheet" href="./shell.css">') });
    expect(kit.transformIndexHtml.handler("", { filename: path.join(tmp, "s/index.html") })).toEqual([
      { tag: "link", attrs: { rel: "preconnect", href: "https://unpkg.com", crossorigin: true }, injectTo: "head-prepend" },
      { tag: "link", attrs: { rel: "stylesheet", href: "https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/basic.css", crossorigin: true }, injectTo: "head-prepend" },
    ]);
    expect(await kit.transform.call(stopper, "p{}", `${tmp}/s/index.html?html-proxy&inline-css&index=0.css`)).toBeNull();
    expect(await kit.transform.call(stopper, 'import "@excom/nucleus-kit/basic.css";', `${tmp}/s/x.js`)).toBeNull();
  });

  it("finds the kit installed nearest the site, and needs one", async () => {
    expect(await kitOf(path.join(tmp, "a/b"))).toMatchObject({ version: "9.9.9" });
    await expect(kitOf(path.parse(tmp).root)).rejects.toThrow('kit "unpkg": @excom/nucleus-kit is not installed');
  });
});

describe("an unpkg build", () => {
  it("rewrites every Nucleus Kit import a page or its stylesheet makes, and ships none of the kit", async () => {
    const output = await built("rewritten", {
      "index.html": page(
        `<link rel="stylesheet" href="./shell.css"><style>@import '@excom/nucleus-kit/basic.css'; b { color: red; }</style>${KIT_SCRIPT}`
      ),
      "shell.css": "@import url('@excom/nucleus-kit/basic.css');\n@import \"@excom/valence/src/mixins.css\";\n@import \"./nested.css\";\np { @mixin quiet; }\n",
      "nested.css": ".nested { color: red; }\n",
    });
    expect(output).not.toMatch(/@import/);
    expect(output.match(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/@excom\/nucleus-kit@9\.9\.9\/dist\/basic\.css" crossorigin>/g)).toHaveLength(1);
    expect(output).toContain("https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/nucleus-kit.progressive.min.js");
    expect(output).toContain(".nested");
    for (const marker of ["kit-code-marker", "kit-marker", "valence-marker"]) expect(output).not.toContain(marker);
  });

  it("stops on a script that bundles the kit or a package it bundles, naming the chunk and the module", async () => {
    await expect(
      built("bare", { "index.html": page('<script type="module">import "@excom/nucleus-kit";</script>') })
    ).rejects.toThrow(/kit "unpkg": assets\/index-[\w-]+\.js holds \.\.\/node_modules\/@excom\/nucleus-kit\/index\.js/);
    await expect(
      built("quark", { "index.html": page('<script type="module">import { Quark } from "@excom/quark"; console.log(Quark);</script>') })
    ).rejects.toThrow(/holds \.\.\/node_modules\/@excom\/quark\/index\.js/);
    expect(
      await built("quark-bundled", { "index.html": page('<script type="module">import { Quark } from "@excom/quark"; console.log(Quark);</script>') }, "bundled")
    ).toContain("quark-code-marker");
  });

  it("stops on a nested @import that would ship CSS of the kit or of a package it bundles", async () => {
    for (const [name, specifier] of [["nested-valence", "@excom/valence/basic.css"], ["nested-kit", "@excom/nucleus-kit/basic.css"]])
      await expect(
        built(name, {
          "index.html": page('<link rel="stylesheet" href="./shell.css">'),
          "shell.css": '@import "./nested.css";\n',
          "nested.css": `@import "${specifier}";\n`,
        })
      ).rejects.toThrow(`kit "unpkg": nested.css imports ${specifier}, Nucleus Kit CSS the build would ship`);
  });

  it("stops on a url() naming the kit", async () => {
    await expect(
      built("url", {
        "index.html": page('<link rel="stylesheet" href="./shell.css">'),
        "shell.css": 'p { background: url("@excom/nucleus-kit/x.svg"); }\n',
      })
    ).rejects.toThrow('kit "unpkg": shell.css names @excom/nucleus-kit/x.svg in a url()');
  });
});

describe("a kit shaped as published", () => {
  const MIN = "https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/nucleus-kit.progressive.min.js";
  const CSS = "https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/basic.css";
  let published: string;

  // `dist/` as the kit's build writes it, and the `exports` map its publish writes from it
  beforeAll(async () => {
    published = path.join(tmp, "published");
    const kit = path.join(published, "node_modules/@excom/nucleus-kit");
    const manifest = { name: "@excom/nucleus-kit", version: "9.9.9", type: "module" };
    writeFiles(kit, {
      "package.json": JSON.stringify({ ...manifest, files: ["dist"] }),
      "dist/index.js": "document.body.dataset.kit = 'published-index-marker';\n",
      "dist/index.d.ts": "",
      "dist/nucleus-kit.progressive.min.js": "document.body.dataset.kit = 'published-code-marker';\n",
      "dist/nucleus-kit.progressive.d.ts": "",
      "dist/basic.css": ".published-marker { color: blue; }\n",
    });
    await buildExports(kit);
    const exports = JSON.parse(readFileSync(path.join(kit, "dist/exports.generated.json"), "utf8"));
    writeFiles(kit, { "package.json": JSON.stringify({ ...manifest, exports }) });
  });

  const entry = (specifier: string) => page(`<script type="module">import "${specifier}";</script>`);

  it("maps a path to the file the kit exports there; a workspace kit, without exports, as its build names it", async () => {
    const [workspace, kit] = await Promise.all([unpkgKitOf(tmp), unpkgKitOf(published)]);
    expect(["nucleus-kit.progressive", "basic.css"].map((path) => workspace.url(path))).toEqual([MIN, CSS]);
    expect(
      ["nucleus-kit.progressive", "nucleus-kit.progressive.min", "basic.css", "nucleus-kit.progressive.min.min"].map((path) => kit.url(path))
    ).toEqual([MIN, MIN, CSS, undefined]);
    const shapes = path.join(tmp, "shapes");
    writeFiles(shapes, {
      "node_modules/@excom/nucleus-kit/package.json": JSON.stringify({
        version: "1.0.0",
        exports: {
          "./a": ["./dist/a.js"],
          "./b": { types: "./dist/b.d.ts", node: "./dist/b.cjs", default: { import: "./dist/b.js" } },
          "./c": null,
        },
      }),
    });
    const shaped = await unpkgKitOf(shapes);
    expect(["a", "b", "c"].map((path) => shaped.url(path))).toEqual([
      "https://unpkg.com/@excom/nucleus-kit@1.0.0/dist/a.js",
      "https://unpkg.com/@excom/nucleus-kit@1.0.0/dist/b.js",
      undefined,
    ]);
  });

  it("bundles the entry by either spelling", async () => {
    for (const spelling of ["nucleus-kit.progressive", "nucleus-kit.progressive.min"])
      expect(await built(`bundled-${spelling}`, { "index.html": entry(`@excom/nucleus-kit/${spelling}`) }, "bundled", published)).toContain(
        "published-code-marker"
      );
  });

  it("loads the file the kit exports from unpkg, by either spelling, and ships none of the kit", async () => {
    for (const spelling of ["nucleus-kit.progressive", "nucleus-kit.progressive.min"]) {
      const output = await built(
        `unpkg-${spelling}`,
        {
          "index.html": entry(`@excom/nucleus-kit/${spelling}`).replace("<head>", '<head><link rel="stylesheet" href="./shell.css">'),
          "shell.css": '@import "@excom/nucleus-kit/basic.css";\np { color: red; }\n',
        },
        "unpkg",
        published
      );
      expect(output).toContain(`<script type="module" crossorigin src="${MIN}"></script>`);
      expect(output).toContain(`href="${CSS}"`);
      expect(output).not.toMatch(/@import/);
      expect(output).not.toMatch(/published-(index-|code-)?marker/);
    }
  });

  it("stops on a path the kit does not export, and on the bare kit", async () => {
    await expect(built("unexported", { "index.html": entry("@excom/nucleus-kit/nucleus-kit.progressive.min.min") }, "unpkg", published)).rejects.toThrow(
      'kit "unpkg": @excom/nucleus-kit/nucleus-kit.progressive.min.min is not a path @excom/nucleus-kit@9.9.9 exports'
    );
    await expect(
      built(
        "unexported-css",
        { "index.html": page('<link rel="stylesheet" href="./shell.css">'), "shell.css": '@import "@excom/nucleus-kit/missing.css";\n' },
        "unpkg",
        published
      )
    ).rejects.toThrow('kit "unpkg": @excom/nucleus-kit/missing.css is not a path @excom/nucleus-kit@9.9.9 exports');
    await expect(built("bare-published", { "index.html": entry("@excom/nucleus-kit") }, "unpkg", published)).rejects.toThrow(
      /kit "unpkg": assets\/index-[\w-]+\.js holds \.\.\/node_modules\/@excom\/nucleus-kit\/dist\/index\.js: import @excom\/nucleus-kit\/<entry>, loaded from unpkg/
    );
  });
});

describe("the kit's stylesheet in an unpkg build", () => {
  const BASE = "https://unpkg.com/@excom/nucleus-kit@9.9.9/dist";
  const head = (html: string) => /<head>([\s\S]*?)<\/head>/.exec(html)![1];
  const pages = (site: string) =>
    ["index.html", "other.html"].map((name) => readFileSync(path.join(tmp, site, "dist", name), "utf8"));
  const SITE = { "shell.css": '@import "@excom/nucleus-kit/basic.css";\np { color: red; }\n' };

  it("links the sheet from the head of every page, after a preconnect, before the site's own", async () => {
    await built("linked", {
      "index.html": page('<link rel="stylesheet" href="./shell.css">'),
      "other.html": page('<style>@import "@excom/nucleus-kit/basic.css"; b { color: red; }</style>'),
      ...SITE,
    });
    const [index, other] = pages("linked");
    for (const html of [index, other]) {
      const [preconnect, sheet] = [
        head(html).indexOf('<link rel="preconnect" href="https://unpkg.com" crossorigin>'),
        head(html).indexOf(`<link rel="stylesheet" href="${BASE}/basic.css" crossorigin>`),
      ];
      expect(preconnect).toBeGreaterThanOrEqual(0);
      expect(sheet).toBeGreaterThan(preconnect);
      expect(html).not.toMatch(/@import/);
    }
    expect(head(index).indexOf('href="/assets/')).toBeGreaterThan(head(index).indexOf(BASE));
    expect(head(other)).toContain("<style");
    expect(head(other).indexOf("<style")).toBeGreaterThan(head(other).indexOf(BASE));
    const css = readdirSync(path.join(tmp, "linked/dist/assets")).filter((file) => file.endsWith(".css"));
    expect(css.length).toBeGreaterThan(0);
    for (const file of css) expect(readFileSync(path.join(tmp, "linked/dist/assets", file), "utf8")).not.toContain("unpkg");
  });

  it("links the minified file when a workspace kit's dist has one, the plain one otherwise", async () => {
    const workspace = path.join(tmp, "min-workspace");
    writeFiles(workspace, {
      "node_modules/@excom/nucleus-kit/package.json": JSON.stringify({ name: "@excom/nucleus-kit", version: "9.9.9" }),
      "node_modules/@excom/nucleus-kit/dist/basic.css": ".a{}",
      "node_modules/@excom/nucleus-kit/dist/basic.min.css": ".a{}",
      "node_modules/@excom/nucleus-kit/dist/plain.css": ".b{}",
    });
    const output = await built(
      "min-workspace-site",
      {
        "index.html": page('<link rel="stylesheet" href="./shell.css">'),
        "shell.css": '@import "@excom/nucleus-kit/basic.css";\n@import "@excom/nucleus-kit/plain.css";\n',
      },
      "unpkg",
      workspace
    );
    expect(output).toContain(`href="${BASE}/basic.min.css"`);
    expect(output).not.toContain(`${BASE}/basic.css`);
    expect(output).toContain(`href="${BASE}/plain.css"`);
  });

  it("links the minified file when a published kit exports one", async () => {
    const published = path.join(tmp, "min-published");
    const kit = path.join(published, "node_modules/@excom/nucleus-kit");
    writeFiles(kit, {
      "package.json": JSON.stringify({ name: "@excom/nucleus-kit", version: "9.9.9", type: "module" }),
      "dist/basic.css": ".a{}",
      "dist/basic.min.css": ".a{}",
      "dist/plain.css": ".b{}",
    });
    await buildExports(kit);
    writeFiles(kit, {
      "package.json": JSON.stringify({
        name: "@excom/nucleus-kit",
        version: "9.9.9",
        exports: JSON.parse(readFileSync(path.join(kit, "dist/exports.generated.json"), "utf8")),
      }),
    });
    const output = await built(
      "min-published-site",
      { "index.html": page('<link rel="stylesheet" href="./shell.css">'), "shell.css": '@import "@excom/nucleus-kit/basic.css";\n@import "@excom/nucleus-kit/plain.css";\n' },
      "unpkg",
      published
    );
    expect(output).toContain(`href="${BASE}/basic.min.css"`);
    expect(output).not.toContain(`${BASE}/basic.css`);
    expect(output).toContain(`href="${BASE}/plain.css"`);
  });

  const hasKit = (site: string, name: string) => {
    const html = readFileSync(path.join(tmp, site, "dist", name), "utf8");
    expect(html.includes('rel="preconnect"')).toBe(html.includes(BASE));
    return html.includes(BASE);
  };

  it("links the sheet only on the pages that use it", async () => {
    await built("scoped", {
      "index.html": page('<link rel="stylesheet" href="./shell.css">'),
      "bare.html": page('<link rel="stylesheet" href="/plain.css">'),
      "shell.css": '@import "@excom/nucleus-kit/basic.css";\np { color: red; }\n',
      "plain.css": "p { color: blue; }\n",
    });
    expect([hasKit("scoped", "index.html"), hasKit("scoped", "bare.html")]).toEqual([true, false]);
  });

  it("links a sheet two pages share on both", async () => {
    await built("shared", {
      "index.html": page('<link rel="stylesheet" href="./shell.css">'),
      "other.html": page('<link rel="stylesheet" href="/shell.css">'),
      "bare.html": page(""),
      ...SITE,
    });
    expect(["index.html", "other.html", "bare.html"].map((name) => hasKit("shared", name))).toEqual([true, true, false]);
  });

  it("keeps an inline <style>'s kit import on its own page", async () => {
    await built("inline", {
      "index.html": page('<style>@import "@excom/nucleus-kit/basic.css"; b { color: red; }</style>'),
      "other.html": page("<style>b { color: red; }</style>"),
    });
    expect([hasKit("inline", "index.html"), hasKit("inline", "other.html")]).toEqual([true, false]);
  });

  it("links a sheet a script imports on every page", async () => {
    await built("imported", {
      "index.html": page('<script type="module" src="./main.js"></script>'),
      "other.html": page(""),
      "main.js": 'import "./shell.css";\n',
      ...SITE,
    });
    expect(["index.html", "other.html"].map((name) => hasKit("imported", name))).toEqual([true, true]);
  });

  it("adds nothing to a page of a site that imports no kit stylesheet, nor to a bundled build", async () => {
    const files = { "index.html": page('<link rel="stylesheet" href="./shell.css">'), "shell.css": "p { color: red; }\n" };
    expect(await built("no-kit-css", files)).not.toContain("unpkg.com");
    const bundled = await built("bundled-css", { ...files, "shell.css": '@import "@excom/nucleus-kit/basic.css";\n' }, "bundled");
    expect(bundled).toContain("kit-marker");
    expect(bundled).not.toContain("unpkg.com");
  });

  it("stops on a kit @import that carries a media query, layer or supports condition", async () => {
    await expect(
      built("conditioned", {
        "index.html": page('<link rel="stylesheet" href="./shell.css">'),
        "shell.css": '@import "@excom/nucleus-kit/basic.css" layer(kit);\n',
      })
    ).rejects.toThrow(/kit "unpkg": .*shell\.css has `@import "@excom\/nucleus-kit\/basic\.css" layer\(kit\)`:/);
  });
});

describe("light-dark()", () => {
  // Valence declares `color-scheme` in a stylesheet compiled on its own (and, in an unpkg build,
  // loaded on its own). Lowered, `light-dark()` waits for two variables that only a sheet
  // declaring `color-scheme` itself is given: every colour an app sets with it would be invalid.
  it.each(["bundled", "unpkg"] as const)("ships as written in a %s build", async (kit) => {
    const out = await built(
      `light-dark-${kit}`,
      {
        "index.html": page(`<link rel="stylesheet" href="./shell.css">${KIT_SCRIPT}`),
        "shell.css":
          '@import "@excom/nucleus-kit/basic.css";\n:root { --ink: light-dark(#1d1b18, #ece7de); }\np { color: var(--ink); }\n',
      },
      kit
    );
    expect(out).toMatch(/--ink:\s*light-dark\(#1d1b18,\s*#ece7de\)/);
    expect(out).not.toContain("lightningcss");
  });
});
