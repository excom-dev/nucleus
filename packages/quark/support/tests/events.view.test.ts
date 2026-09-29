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

describe("events view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prevents navigation and notes the event", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "events"));
    const anchor = root.querySelector("a")!;
    const meter = measureComplexity(quark!);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(ev);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(ev.defaultPrevented).toBe(true);
    expect(root.querySelector("output")?.textContent).toBe(
      "click handled — navigation prevented",
    );
    expectComplexity(budget);
  });
});
