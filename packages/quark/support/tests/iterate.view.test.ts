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

describe("iterate view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the planet list", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "iterate"));
    await flush();
    const meter = measureComplexity(quark!);
    const budget = meter.take();
    meter.stop();
    expect([...root.querySelectorAll("li")].map((el) => el.textContent)).toEqual([
      "Mercury",
      "Venus",
      "Earth",
      "Mars",
    ]);
    expectComplexity(budget);
  });
});
