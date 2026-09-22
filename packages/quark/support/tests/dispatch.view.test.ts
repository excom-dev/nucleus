import "@excom/quark-sheet";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  click,
  expectComplexity,
  flush,
  installDemoModules,
  measureComplexity,
  mountView,
  readDemo,
  restoreDemoModules,
} from "./view-helpers";

describe("dispatch view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("relays a click to the panel as a custom event the panel's own block turns into State", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "dispatch"));
    const panel = root.querySelector("[aria-label='panel']")!;
    const meter = measureComplexity(quark!);
    click(root.querySelector("button"));
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(panel.getAttribute("data-pings")).toBe("1");
    expect(root.querySelector("output")?.textContent).toBe("pinged 1×");
    click(root.querySelector("button"));
    await flush();
    expect(panel.getAttribute("data-pings")).toBe("2");
    expect(root.querySelector("output")?.textContent).toBe("pinged 2×");
    expectComplexity(budget);
  });
});
