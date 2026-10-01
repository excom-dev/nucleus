import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

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
