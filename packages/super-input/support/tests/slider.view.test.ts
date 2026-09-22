import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("slider view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reflects the range value", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "slider"));
    const input = root.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("36");
    input.value = "40";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(root.getAttribute("current-value")).toBe("40");
  });
});
