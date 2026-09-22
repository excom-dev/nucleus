import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  spyFetch,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
  readDemo,
} from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the fetched todo", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ id: 7, title: "Ship it", completed: false }),
    });
    const { root, quark } = await mountView(readDemo(import.meta.url, "simple"));
    const provider = root.querySelector("provider-fetch")!;
    if (!provider.hasAttribute("is-success")) {
      await waitForEvent(provider, "provider-fetch-success");
      await flush();
    }
    const meter = measureComplexity(quark!);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("h4")?.textContent).toMatch(/Todo #7: Ship it/);
    expect(root.querySelector("span")?.textContent).toMatch(/Completed: false/);
    expectComplexity(budget);
  });
});
