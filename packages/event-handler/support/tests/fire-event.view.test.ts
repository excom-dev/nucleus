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
  click,
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";

describe("fire-event view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("writes cart-add detail to output", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "fire-event"));
    const meter = measureComplexity(quark!);
    click(root.querySelector("event-handler"));
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toBe('{"sku":"sku-1"}');
    expectComplexity(budget);
  });
});
