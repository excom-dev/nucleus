import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("labels the details panel open and closed", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "simple"));
    const details = root.querySelector("details")!;
    expect(details.querySelector("summary")?.textContent).toBe("Panel Closed");
    const meter = measureComplexity(quark!);
    details.setAttribute("open", "");
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(details.querySelector("summary")?.textContent).toBe("Panel Open");
    expectComplexity(budget);
  });
});
