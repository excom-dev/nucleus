import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists feature support on the element", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const el = root.querySelector("detect-features")!;
    expect(
      el.hasAttribute("full-support") || el.hasAttribute("no-support"),
    ).toBe(true);
  });
});
