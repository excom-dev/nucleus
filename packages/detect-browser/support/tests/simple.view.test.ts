import "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { mountView, readDemo } from "@excom/quark/support/tests/view-helpers";

describe("simple view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("populates browser attributes", async () => {
    const { root } = await mountView(readDemo(import.meta.url, "simple"));
    const el = root.querySelector("detect-browser")!;
    expect(el.getAttribute("browser-name") || el.getAttribute("device-type")).toBeTruthy();
  });
});
