import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cssConfig,
  heftRigCssPlugin,
  transformCss,
} from "../../scripts/css-config.mjs";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-css-config-"));
  await writeFile(
    path.join(root, "imported.css"),
    `@define-mixin badge $color { .badge { color: $color } }\n.imported { color: green }\n`,
  );
  await writeFile(path.join(root, "glob-a.css"), `.glob-a { color: red }\n`);
  await writeFile(path.join(root, "glob-b.css"), `.glob-b { color: blue }\n`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("css-config", () => {
  it("exposes a single postcss plugin chain", () => {
    expect(Array.isArray(cssConfig.postcss.plugins)).toBe(true);
    expect(cssConfig.postcss.plugins.length).toBe(6);
  });

  it("inlines imports, expands mixins and custom selectors and keeps nesting", async () => {
    const entry = path.join(root, "entry.css");
    const css = `
@import "./imported.css";
@import-glob "./glob-*.css";
@custom-selector :--article article, .tag-article;
@mixin badge purple;
@scope (:--article) to (.end) { p { color: red } }
:--article:hover { color: blue }
.parent { & .child { color: pink } }
`;
    const out = await transformCss(css, entry);
    expect(out).toContain(".imported {");
    expect(out).toContain(".glob-a {");
    expect(out).toContain(".glob-b {");
    expect(out).toContain(".badge {");
    expect(out).toContain("color: purple");
    expect(out).toContain("@scope (:is(article, .tag-article)) to (.end)");
    expect(out).toMatch(/:is\(article, \.tag-article\):hover/);
    expect(out).not.toContain("@custom-selector");
    expect(out).not.toContain("@define-mixin");
    // Nesting is shipped as authored.
    expect(out).toContain("& .child");
  });

  it("provides a pre transform plugin for CSS ids only", async () => {
    const plugin = heftRigCssPlugin();
    expect(plugin.name).toBe("heft-rig-css");
    expect(plugin.enforce).toBe("pre");
    expect(await plugin.transform("const a = 1;", "/x/a.ts")).toBeNull();
    expect(await plugin.transform("a{}", "/x/a.ts?x=1.css")).toBeNull();
    const entry = path.join(root, "plugin.css");
    const result = await plugin.transform(
      `@custom-selector :--btn button, .btn;\n:--btn { color: red }\n`,
      `${entry}?direct`,
    );
    expect(result).toEqual({ code: expect.any(String), map: null });
    expect(result.code).toContain(":is(button, .btn)");
  });
});
