import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  readDemo,
} from "@excom/nucleus-test";
import { mountView } from "@excom/quark/support/tests/view-helpers";

describe("invalid-message view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes the custom invalid message", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "invalid-message"));
    const host = root.querySelector("super-input")!;
    expect(host.getAttribute("invalid-message")).toMatch(/US phone/);
    expect(host.querySelector("input")?.required).toBe(true);
    expect(host.querySelector("input")?.inputMode).toBe("numeric");
  });
});
