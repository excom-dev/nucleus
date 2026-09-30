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

describe("unset view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shadows $foo while open and falls back when closed", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "unset"));
    expect(root.querySelector("[bind-foo]")?.textContent).toBe(
      "$foo resolves to 1",
    );
    const details = root.querySelector("details")!;
    const meter = measureComplexity(quark!);
    details.setAttribute("open", "");
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("[bind-foo]")?.textContent).toBe(
      "$foo resolves to 2",
    );
    details.removeAttribute("open");
    await flush();
    expect(root.querySelector("[bind-foo]")?.textContent).toBe(
      "$foo resolves to 1",
    );
    expectComplexity(budget);
  });
});
