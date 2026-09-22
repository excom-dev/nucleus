import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("share view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("classifies share support", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "share"));
    const el = root.querySelector("detect-features")!;
    expect(
      el.hasAttribute("full-support") || el.hasAttribute("no-support"),
    ).toBe(true);
  });
});
