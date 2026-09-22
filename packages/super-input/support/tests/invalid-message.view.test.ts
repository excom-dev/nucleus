import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("invalid-message view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("exposes the custom invalid message", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "invalid-message"));
    const host = root.querySelector("super-input")!;
    expect(host.getAttribute("invalid-message")).toMatch(/US phone/);
    expect(host.querySelector("input")?.required).toBe(true);
  });
});
