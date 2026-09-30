import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  readDemo,
  waitForEvent,
} from "@excom/nucleus-test";
import { DEMO_STORAGE_KEY } from "../../../docs-site/public/demo-utils";
import {
  click,
  expectComplexity,
  flush,
  installDemoModules,
  measureComplexity,
  mountView,
  restoreDemoModules,
} from "@excom/quark/support/tests/view-helpers";

const storedTime = () =>
  JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)!).seededAt;

describe("simple view", () => {
  beforeEach(() => {
    localStorage.clear();
    installDemoModules();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    restoreDemoModules();
    localStorage.clear();
  });

  it("prints the stored value and re-reads after a same-tab seed", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "simple"));
    const provider = root.querySelector("provider-storage")!;
    const output = root.querySelector("output")!;
    expect(output.textContent).toBe("never");
    const meter = measureComplexity(quark!);
    await waitForEvent(provider, "neutron-provision", () => {
      click(root.querySelector("button"));
    });
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(output.textContent).toBe(storedTime());
    expectComplexity(budget);
  });

  it("reads a value stored before it mounted", async () => {
    localStorage.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({ seededAt: "an earlier visit" }),
    );
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const output = root.querySelector("output")!;
    expect(output.textContent).toBe("an earlier visit");
    await waitForEvent(root.querySelector("provider-storage")!, "neutron-provision", () => {
      click(root.querySelector("button"));
    });
    await flush();
    expect(output.textContent).toBe(storedTime());
  });
});
