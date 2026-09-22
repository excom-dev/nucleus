import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("comprehensive view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("combines format, invalid-message, and auto-label", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "comprehensive"));
    const host = root.querySelector("super-input")!;
    expect(host.hasAttribute("auto-label")).toBe(true);
    expect(host.getAttribute("text-format")).toBe("(xxx) xxx-xxxx");
    expect(host.getAttribute("invalid-message")).toMatch(/US phone/);
  });
});
