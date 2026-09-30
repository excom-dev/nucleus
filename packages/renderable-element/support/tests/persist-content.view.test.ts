import "@excom/include-content";
import "@excom/quark-sheet";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import {
  expectComplexity,
  flush,
  measureComplexity,
  mountView,
} from "@excom/quark/support/tests/view-helpers";

const toggle = (checkbox: HTMLInputElement, checked: boolean) => {
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("persist-content view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the persisted input across toggle", async () => {
    const { root, quark } = await mountView(readDemo(import.meta.url, "persist-content"));
    const [cloned, persisted] = root.querySelectorAll("include-content");
    const [clonedToggle, persistedToggle] =
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    cloned.querySelector("input")!.value = "typed";
    persisted.querySelector("input")!.value = "kept";
    const meter = measureComplexity(quark!);
    toggle(persistedToggle, false);
    await flush();
    const budget = meter.take();
    meter.stop();
    expect(persisted.hasAttribute("is-active")).toBe(false);
    expect(cloned.hasAttribute("is-active")).toBe(true);
    toggle(clonedToggle, false);
    await flush();
    toggle(persistedToggle, true);
    toggle(clonedToggle, true);
    await flush();
    expect(persisted.hasAttribute("is-active")).toBe(true);
    expect(persisted.querySelector("input")?.value).toBe("kept");
    expect(cloned.querySelector("input")?.value).toBe("");
    expectComplexity(budget);
  });
});
