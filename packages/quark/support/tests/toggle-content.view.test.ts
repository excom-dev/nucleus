import "@excom/quark-sheet";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "./view-helpers";

describe("toggle-content view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reflects details open and closed", async () => {
    const { root, quark } = await mountView(
      readDemo(import.meta.url, "toggle-content"),
    );
    const details = root.querySelector("details")!;
    const status = root.querySelector("[bind-status]")!;
    expect(status.textContent).toBe("Closed");
    const meter = measureComplexity(quark!);
    details.setAttribute("open", "");
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(details.hasAttribute("open")).toBe(true);
    expect(status.textContent).toBe("Open");
    details.removeAttribute("open");
    await flush();
    expect(status.textContent).toBe("Closed");
    expectComplexity(budget);
  });
});
