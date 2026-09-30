import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("lazy view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("starts inactive with lazy-load and lazy-unload set", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "lazy"));
    const include = root.querySelector("include-content")!;
    expect(include.hasAttribute("lazy-load")).toBe(true);
    expect(include.hasAttribute("lazy-unload")).toBe(true);
    expect(include.hasAttribute("is-active")).toBe(false);
  });
});
