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
  click,
  expectComplexity,
  flush,
  installDemoModules,
  measureComplexity,
  mountView,
  readDemo,
  restoreDemoModules,
} from "@excom/quark/support/tests/view-helpers";

describe("retarget view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("pings the previous output", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "retarget"));
    const meter = measureComplexity(quark!);
    click(root.querySelector("event-handler"));
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toMatch(/pong/);
    expectComplexity(budget);
  });
});
