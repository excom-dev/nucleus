import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("language view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes a language-id", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "language"));
    expect(root.querySelector("detect-browser")?.hasAttribute("language-id")).toBe(
      true,
    );
  });
});
