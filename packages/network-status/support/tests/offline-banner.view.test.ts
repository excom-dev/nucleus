import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("offline-banner view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the offline banner markup next to network-status", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "offline-banner"));
    expect(root.querySelector("network-status")).toBeTruthy();
    expect(root.querySelector("[role='alert']")?.textContent).toMatch(/offline/i);
  });
});
