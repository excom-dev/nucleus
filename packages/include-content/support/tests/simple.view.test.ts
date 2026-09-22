import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the template when activated", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const include = root.querySelector("include-content")!;
    expect(include.hasAttribute("is-active")).toBe(false);
    include.setAttribute("is-active", "");
    await flush();
    expect(include.textContent).toMatch(/HTML inserted/);
  });
});
