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

  it("reflects online status", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const el = root.querySelector("network-status")!;
    expect(el.hasAttribute("is-online") || el.hasAttribute("is-offline")).toBe(
      true,
    );
  });
});
