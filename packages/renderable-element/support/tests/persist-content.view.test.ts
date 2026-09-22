import "@excom/include-content";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("persist-content view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the persisted input across toggle", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "persist-content"));
    const persisted = root.querySelector("#persisted") as HTMLElement;
    const input = persisted.querySelector("input")!;
    input.value = "kept";
    const toggle = root.querySelector<HTMLInputElement>(
      'input[data-target="#persisted"]',
    )!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(persisted.querySelector("input")?.value).toBe("kept");
  });
});
