import "@excom/provider-fetch";
import "@excom/quark-sheet";
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
} from "./view-helpers";

describe("provider-list view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("iterates fetched todos", async () => {
    spyFetch({
      status: 200,
      body: JSON.stringify([{ id: 1, title: "Alpha" }, { id: 2, title: "Beta" }]),
    });
    const { root, quark } = await mountView(
      readDemo(import.meta.url, "provider-list"),
    );
    const provider = root.querySelector("provider-fetch")!;
    if (!provider.hasAttribute("is-success")) {
      await waitForEvent(provider, "provider-fetch-success");
      await flush();
    }
    const meter = measureComplexity(quark!);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect([...root.querySelectorAll("li")].map((el) => el.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expectComplexity(budget);
  });
});
