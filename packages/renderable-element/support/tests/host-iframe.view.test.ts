import "@excom/include-content";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("host-iframe view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts an iframe-host include-content", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "host-iframe"));
    expect(root.matches("include-content")).toBe(true);
    expect(root.hasAttribute("is-active")).toBe(true);
    expect(root.getAttribute("host-ref")).toBe("iframe");
    expect(root.querySelector("iframe")).toBeTruthy();
  });
});
