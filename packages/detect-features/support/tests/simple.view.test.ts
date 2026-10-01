import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

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
