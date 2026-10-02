import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as pluginCss from "../../../vite-plugin-nucleus/css.mjs";
import {
  cssConfig,
  heftRigCssPlugin,
  transformCss,
} from "../../scripts/css-config.mjs";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-css-config-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("css-config", () => {
  it("is the site plugin's CSS config, by path", () => {
    expect(cssConfig).toBe(pluginCss.cssConfig);
    expect(transformCss).toBe(pluginCss.transformCss);
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
