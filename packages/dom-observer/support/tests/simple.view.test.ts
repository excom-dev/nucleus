import "@excom/quark-sheet";
import "../../index";
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
} from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports each mutation of the details element", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "simple"));
    const details = root.querySelector("details")!;
    const output = root.querySelector("output")!;
    const meter = measureComplexity(quark!);
    details.setAttribute("open", "");
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(output.textContent).toBe("1 mutation(s), open: true");
    details.removeAttribute("open");
    await flush();
    expect(output.textContent).toBe("1 mutation(s), open: false");
    expectComplexity(budget);
  });
});
