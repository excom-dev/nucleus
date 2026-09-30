import "@excom/quark-sheet";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { flush, mountView } from "@excom/quark/support/tests/view-helpers";

describe("slider view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reflects the range value", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "slider"));
    const superInput = root.querySelector("super-input")!;
    const input = root.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("36");
    input.value = "40";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(superInput.getAttribute("current-value")).toBe("40");
  });
});
