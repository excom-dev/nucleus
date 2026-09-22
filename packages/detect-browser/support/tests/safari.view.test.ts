import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  installDemoModules,
  mountView,
  readDemo,
  restoreDemoModules,
} from "@excom/quark/support/tests/view-helpers";

describe("safari view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("mounts detect-browser without treating happy-dom as Safari", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "safari"));
    const el = root.querySelector("detect-browser")!;
    expect(el.getAttribute("browser-name")).not.toBe("safari");
  });
});
