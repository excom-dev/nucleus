import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
  vi,
} from "@excom/nucleus-test";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";

describe("debounce view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("coalesces a burst of input into one search-query", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "debounce"));
    const input = root.querySelector<HTMLInputElement>('input[name="detail.q"]')!;
    const output = root.querySelector("output")!;
    const details: unknown[] = [];
    root.addEventListener("search-query", (e) =>
      details.push((e as CustomEvent).detail),
    );
    const meter = measureComplexity(quark!);
    // one synchronous burst: all three land inside the 200ms window
    ["o", "oa", "oak"].forEach((value) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await vi.waitFor(() => expect(output.textContent).not.toBe("Waiting…"), {
      timeout: 2000,
    });
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(details).toEqual([{ q: "oak", strict: false }]);
    expect(JSON.parse(output.textContent!)).toEqual({ q: "oak", strict: false });
    expectComplexity(budget);
  });
});
