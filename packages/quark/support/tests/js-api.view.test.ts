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

describe("js-api view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("increments the click count through element.quark", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "js-api"));
    expect(root.querySelector("output")?.textContent).toBe("Clicked 0 times");
    const meter = measureComplexity(quark!);
    click(root.querySelector("button"));
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toBe("Clicked 1 times");
    click(root.querySelector("button"));
    await flush();
    expect(root.querySelector("output")?.textContent).toBe("Clicked 2 times");
    const owner = root.matches("[data-demo-counter]")
      ? root
      : root.querySelector("[data-demo-counter]")!;
    expect(owner.quark.getPropertyValue("$count")).toBe(2);
    expectComplexity(budget);
  });
});
