import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  installDemoModules,
  measureComplexity,
  mountView,
  readDemo,
  restoreDemoModules,
} from "@excom/quark/support/tests/view-helpers";

describe("debounce view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("emits search-query after the debounce window", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "debounce"));
    const input = root.querySelector<HTMLInputElement>('input[name="detail.q"]')!;
    input.value = "oak";
    const meter = measureComplexity(quark!);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(root.querySelector("output")?.textContent).toBe("Waiting…");
    await wait(220);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toMatch(/oak/);
    expectComplexity(budget);
  });
});
