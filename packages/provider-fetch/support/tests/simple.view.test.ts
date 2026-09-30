import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
  spyFetch,
  waitForEvent,
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
