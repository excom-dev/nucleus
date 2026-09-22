import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("reflect-value view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reflects typed email onto current-value", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "reflect-value"));
    const host = root as unknown as HTMLSuperInputElement;
    const input = root.querySelector("input")!;
    input.value = "a@b.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(host.getAttribute("current-value")).toBe("a@b.com");
  });
});
