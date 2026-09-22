import "@excom/event-handler";
import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  waitForEvent,
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
} from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
    localStorage.clear();
  });

  it("seeds storage and prints the provision", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "simple"));
    const provider = root.querySelector("provider-storage")!;
    const meter = measureComplexity(quark!);
    await waitForEvent(provider, "neutron-provision", () => {
      click(root.querySelector("[role='button']"));
    });
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toMatch(/seededAt/);
    expectComplexity(budget);
  });
});
