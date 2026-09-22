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

describe("events view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
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
    expect(root.querySelector("output")?.textContent).toMatch(/handled/);
    expectComplexity(budget);
  });
});
