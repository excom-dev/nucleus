import "@excom/quark-sheet";
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
} from "./view-helpers";

describe("css-variables view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("writes --border-color for open and closed details", async () => {
    const { root, quark } = await mountView(
      readDemo(import.meta.url, "css-variables"),
    );
    const details = root.querySelector("details")!;
    expect(details.style.getPropertyValue("--border-color")).toBe("silver");
    const meter = measureComplexity(quark!);
    details.setAttribute("open", "");
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(details.style.getPropertyValue("--border-color")).toBe("#3fa9f5");
    expectComplexity(budget);
  });
});
