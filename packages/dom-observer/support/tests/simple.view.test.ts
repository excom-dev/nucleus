import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
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

describe("simple view", () => {
  beforeEach(() => installDemoModules());
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
  });

  it("logs attribute mutations on the details element", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "simple"));
    const details = root.querySelector("details")!;
    const meter = measureComplexity(quark!);
    details.setAttribute("open", "");
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("output")?.textContent).toMatch(
      /HTMLDetailsElement|MutationRecord/,
    );
    expectComplexity(budget);
  });
});
