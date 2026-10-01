import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

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
    // digits-only keypad on touch devices
    expect(host.querySelector("input")?.inputMode).toBe("numeric");
  });
});
