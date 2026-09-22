/**
 * The `@use "/devtools-ui"` loader override: serves the bundled helpers for
 * the pane's URL and defers every other URL to Quark's default loader.
 */
import "../../lib/quark-modules";
import { UI_MODULE_URL } from "../../lib/quark-modules";
import * as ui from "../../lib/ui";
import { Quark } from "@excom/quark";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("quark-modules loader", () => {
  it("resolves the pane's helper module from the bundle", async () => {
    const mod = await Quark.moduleLoader(UI_MODULE_URL);
    expect(mod.renderTree).toBe(ui.renderTree);
    expect(mod.quarkApplies).toBe(ui.quarkApplies);
    expect(Object.keys(mod).sort()).toEqual(Object.keys(ui).sort());
  });

  it("hands any other URL to the default loader", async () => {
    const outcome = await Quark.moduleLoader("/no-such-module").then(
      (mod) => ({ resolved: mod }),
      (error: unknown) => ({ rejected: error }),
    );
    expect("resolved" in outcome && outcome.resolved.renderTree).toBeFalsy();
  });
});
