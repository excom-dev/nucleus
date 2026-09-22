import "@excom/provider-fetch";
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

describe("provider view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("binds a fetched todo title", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify({ id: 1, title: "Write docs" }),
    });
    const { root, quark } = await mountView(readDemo(import.meta.url, "provider"));
    const provider = root.querySelector("provider-fetch")!;
    if (!provider.hasAttribute("is-success")) {
      await waitForEvent(provider, "provider-fetch-success");
      await flush();
    }
    const meter = measureComplexity(quark!);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(root.querySelector("[bind-title]")?.textContent).toBe("Write docs");
    expectComplexity(budget);
  });
});
