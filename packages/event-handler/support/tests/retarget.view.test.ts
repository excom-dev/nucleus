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

describe("retarget view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("pings the previous output", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "retarget"));
    const meter = measureComplexity(quark!);
    click(root.querySelector("event-handler"));
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toBe("pong");
    expectComplexity(budget);
  });
});
